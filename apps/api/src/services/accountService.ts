import type pg from 'pg';
import { lamportsToSol, type ActivityItemDto, type WalletOverviewDto } from '@wallet/shared';
import type { BlockchainProvider } from '../blockchain/types.js';
import { logger } from '../lib/logger.js';
import type { DepositSyncService } from './depositSyncService.js';
import type { LedgerService } from './ledgerService.js';
import type { WalletService } from './walletService.js';
import type { WithdrawalService } from './withdrawalService.js';

/** Minimum time between automatic syncs triggered by UI polling (all instances). */
export const OVERVIEW_SYNC_INTERVAL_MS = 4_000;

/**
 * Read models for the wallet UI: the overview (ledger balance first) and the
 * user-facing activity history, backed by the deposits and withdrawals tables.
 */
export class AccountService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
    private readonly blockchain: BlockchainProvider,
    private readonly sync: DepositSyncService,
    private readonly withdrawals: WithdrawalService,
  ) {}

  /**
   * Also drives deposit detection on serverless deployments: each poll syncs
   * the wallet at most once per OVERVIEW_SYNC_INTERVAL_MS. A sync failure
   * (e.g. RPC rate limit) is reported, never fatal.
   */
  async getOverview(userId: string, { forceSync = false } = {}): Promise<WalletOverviewDto> {
    const wallet = await this.wallets.getOrCreateWallet(userId);

    let sync: WalletOverviewDto['sync'];
    try {
      const result = await this.sync.syncUser(userId, { minIntervalMs: forceSync ? 1_000 : OVERVIEW_SYNC_INTERVAL_MS });
      sync = { status: result.status, lastSyncedAt: null };
    } catch (error) {
      logger.warn('Sync during overview failed', { userId, error: error instanceof Error ? error.message : String(error) });
      sync = { status: 'error', message: 'Could not reach Solana Devnet to check for new deposits.', lastSyncedAt: null };
    }

    const [available, onChain, pending, lastSyncedAt] = await Promise.all([
      this.ledger.getAvailableBalance(userId),
      this.blockchain.getBalance(wallet.address).catch(() => null),
      this.pool.query<{ incoming: string; outgoing: string }>(
        `SELECT
           (SELECT COALESCE(SUM(amount_lamports), 0) FROM deposits
             WHERE user_id = $1 AND status IN ('detected', 'confirming'))::text AS incoming,
           (SELECT COALESCE(SUM(reserved_lamports), 0) FROM withdrawals
             WHERE user_id = $1 AND status IN ('pending', 'processing', 'broadcast', 'confirming'))::text AS outgoing`,
        [userId],
      ),
      this.sync.lastSyncedAt(wallet.id),
    ]);

    const amount = (lamports: bigint) => ({ lamports: lamports.toString(), sol: lamportsToSol(lamports) });
    return {
      network: wallet.network,
      address: wallet.address,
      available: amount(available),
      onChain: onChain === null ? null : amount(onChain),
      pending: {
        incomingLamports: pending.rows[0]?.incoming ?? '0',
        outgoingLamports: pending.rows[0]?.outgoing ?? '0',
      },
      withdrawals: this.withdrawals.policyDto(),
      sync: { ...sync, lastSyncedAt: lastSyncedAt?.toISOString() ?? null },
    };
  }

  async getActivity(userId: string, limit: number): Promise<ActivityItemDto[]> {
    const { rows } = await this.pool.query<{
      id: string;
      kind: 'deposit' | 'withdrawal';
      amount: string;
      fee: string | null;
      status: ActivityItemDto['status'];
      signature: string | null;
      counterparty: string | null;
      occurred_at: Date;
      settled_at: Date | null;
    }>(
      `SELECT id, 'deposit' AS kind, amount_lamports::text AS amount, NULL AS fee, status, signature,
              NULL AS counterparty, COALESCE(block_time, detected_at) AS occurred_at, confirmed_at AS settled_at
         FROM deposits WHERE user_id = $1
       UNION ALL
       SELECT id, 'withdrawal', (-amount_lamports)::text, fee_lamports::text, status, signature,
              destination_address, created_at, completed_at
         FROM withdrawals WHERE user_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amountLamports: r.amount,
      feeLamports: r.fee,
      status: r.status,
      signature: r.signature,
      explorerUrl: r.signature ? this.blockchain.explorerUrl('tx', r.signature) : null,
      counterparty: r.counterparty,
      createdAt: r.occurred_at.toISOString(),
      settledAt: r.settled_at?.toISOString() ?? null,
    }));
  }
}
