import type pg from 'pg';
import type { DepositStatus } from '@wallet/shared';
import type { BlockchainProvider, SignatureStatus, TransactionDetails } from '../blockchain/types.js';
import { withTransaction } from '../db/transaction.js';
import { logger } from '../lib/logger.js';
import type { WalletAccount } from '../repositories/walletAccountRepository.js';
import type { LedgerService } from './ledgerService.js';
import type { WalletService } from './walletService.js';
import type { WithdrawalService } from './withdrawalService.js';

export interface SyncResult {
  status: 'ok' | 'skipped';
  imported: number;
  credited: number;
}

/** Net native-SOL effect of a transaction on one address. */
export function summarizeTransfers(details: TransactionDetails, address: string) {
  let incoming = 0n;
  let outgoing = 0n;
  for (const t of details.transfers) {
    if (t.destination === address && t.source !== address) incoming += t.lamports;
    if (t.source === address && t.destination !== address) outgoing += t.lamports;
  }
  const direction =
    incoming > outgoing
      ? 'inbound'
      : outgoing > incoming
        ? 'outbound'
        : details.feePayer === address
          ? 'self'
          : 'unknown';
  return { incoming, outgoing, direction } as const;
}

/** Deposit status for a signature status. Only `finalized` is final (credited). */
export function depositStatusFor(status: SignatureStatus): DepositStatus {
  if (status.failed) return 'failed';
  if (status.status === 'finalized') return 'confirmed';
  if (status.status === 'confirmed') return 'confirming';
  return 'detected';
}

/**
 * Detects incoming native SOL transfers to custodial wallets and records them.
 *
 *   1. import  — new signatures → blockchain_transactions (+ deposits for inbound SOL)
 *   2. advance — pending deposits follow chain commitment:
 *                detected → confirming → confirmed (ledger credited once) | failed
 *   3. reconcile in-flight withdrawals (WithdrawalService)
 *
 * Idempotent by construction: UNIQUE (wallet_account_id, signature) on
 * blockchain_transactions, UNIQUE (signature) on deposits and the ledger's
 * unique reference. Re-running, restarting or running concurrently never
 * duplicates a deposit or a credit.
 */
export class DepositSyncService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
    private readonly blockchain: BlockchainProvider,
    private readonly withdrawals: WithdrawalService,
    private readonly options: { signatureLimit: number } = { signatureLimit: 25 },
  ) {}

  /** Syncs one user's wallet unless it was synced less than `minIntervalMs` ago. */
  async syncUser(userId: string, { minIntervalMs = 0 } = {}): Promise<SyncResult> {
    const wallet = await this.wallets.getOrCreateWallet(userId);
    if (!(await this.#claim(wallet, minIntervalMs))) return { status: 'skipped', imported: 0, credited: 0 };

    const imported = await this.#importNewTransactions(wallet);
    const credited = await this.#advanceDeposits(wallet);
    await this.withdrawals.reconcile(wallet);
    if (imported || credited) logger.info('Deposit sync', { userId, address: wallet.address, imported, credited });
    return { status: 'ok', imported, credited };
  }

  /** Background loop entry point (long-running server only). */
  async syncAllWallets(minIntervalMs: number): Promise<void> {
    const { rows } = await this.pool.query<{ user_id: string }>('SELECT user_id FROM wallet_accounts');
    for (const { user_id } of rows) {
      await this.syncUser(user_id, { minIntervalMs }).catch((error: unknown) =>
        logger.warn('Deposit sync failed', { userId: user_id, error: error instanceof Error ? error.message : String(error) }),
      );
    }
  }

  async lastSyncedAt(walletId: string): Promise<Date | null> {
    const { rows } = await this.pool.query<{ last_synced_at: Date | null }>(
      'SELECT last_synced_at FROM wallet_accounts WHERE id = $1',
      [walletId],
    );
    return rows[0]?.last_synced_at ?? null;
  }

  /** Atomic throttle shared by all instances: only one caller per interval proceeds. */
  async #claim(wallet: WalletAccount, minIntervalMs: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE wallet_accounts SET last_synced_at = now()
       WHERE id = $1 AND (last_synced_at IS NULL OR last_synced_at <= now() - ($2::int * interval '1 millisecond'))`,
      [wallet.id, minIntervalMs],
    );
    return Boolean(rowCount);
  }

  async #importNewTransactions(wallet: WalletAccount): Promise<number> {
    const signatures = await this.blockchain.getRecentSignatures(wallet.address, this.options.signatureLimit);
    if (signatures.length === 0) return 0;

    const { rows } = await this.pool.query<{ signature: string }>(
      'SELECT signature FROM blockchain_transactions WHERE wallet_account_id = $1 AND signature = ANY($2)',
      [wallet.id, signatures.map((s) => s.signature)],
    );
    const known = new Set(rows.map((r) => r.signature));
    let imported = 0;

    // Oldest first, so history is recorded in chain order.
    for (const info of [...signatures].reverse()) {
      if (known.has(info.signature)) continue;
      const details = await this.blockchain.getTransaction(info.signature);
      if (!details) continue; // not visible yet; picked up by a later sync

      const { incoming, outgoing, direction } = summarizeTransfers(details, wallet.address);
      const status = details.failed ? 'failed' : info.status;
      const net = incoming - outgoing;

      await withTransaction(this.pool, async (db) => {
        const inserted = await db.query(
          `INSERT INTO blockchain_transactions
             (wallet_account_id, signature, direction, amount_lamports, fee_lamports, slot, block_time, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (wallet_account_id, signature) DO NOTHING`,
          [wallet.id, details.signature, direction, net.toString(), details.feeLamports.toString(), details.slot, details.blockTime, status],
        );
        if (!inserted.rowCount) return;
        imported++;
        if (incoming > 0n) {
          await db.query(
            `INSERT INTO deposits (user_id, wallet_account_id, signature, amount_lamports, status, slot, block_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (signature) DO NOTHING`,
            [wallet.userId, wallet.id, details.signature, incoming.toString(), details.failed ? 'failed' : 'detected', details.slot, details.blockTime],
          );
        }
      });
    }
    return imported;
  }

  /** Moves pending deposits (and transaction records) forward with chain commitment. */
  async #advanceDeposits(wallet: WalletAccount): Promise<number> {
    const { rows } = await this.pool.query<{ signature: string }>(
      `SELECT signature FROM blockchain_transactions WHERE wallet_account_id = $1 AND status IN ('processed', 'confirmed')
       UNION
       SELECT signature FROM deposits WHERE wallet_account_id = $1 AND status IN ('detected', 'confirming')`,
      [wallet.id],
    );
    if (rows.length === 0) return 0;

    const statuses = await this.blockchain.getSignatureStatuses(rows.map((r) => r.signature));
    let credited = 0;
    for (const [signature, status] of statuses) {
      if (!status) continue;
      await this.pool.query(
        `UPDATE blockchain_transactions SET status = $3
         WHERE wallet_account_id = $1 AND signature = $2 AND status NOT IN ('failed', 'finalized')`,
        [wallet.id, signature, status.failed ? 'failed' : status.status],
      );
      if (await this.#advanceDeposit(wallet, signature, status)) credited++;
    }
    return credited;
  }

  /** One deposit transition, atomic with its ledger credit. Returns true if credited now. */
  async #advanceDeposit(wallet: WalletAccount, signature: string, status: SignatureStatus): Promise<boolean> {
    return withTransaction(this.pool, async (db) => {
      const { rows } = await db.query<{ id: string; user_id: string; amount_lamports: string; status: DepositStatus }>(
        `SELECT id, user_id, amount_lamports, status FROM deposits
         WHERE wallet_account_id = $1 AND signature = $2 FOR UPDATE`,
        [wallet.id, signature],
      );
      const deposit = rows[0];
      if (!deposit || deposit.status === 'confirmed' || deposit.status === 'failed') return false;

      const next = depositStatusFor(status);
      if (next === deposit.status) return false;

      let credited = false;
      if (next === 'confirmed') {
        credited = await this.ledger.creditDeposit(db, {
          userId: deposit.user_id,
          depositId: deposit.id,
          amount: BigInt(deposit.amount_lamports),
        });
      }
      await db.query(
        `UPDATE deposits SET status = $2, updated_at = now(),
           confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE confirmed_at END
         WHERE id = $1`,
        [deposit.id, next],
      );
      return credited;
    });
  }
}
