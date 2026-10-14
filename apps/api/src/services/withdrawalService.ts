import type pg from 'pg';
import {
  InvalidAmountError,
  lamportsToSol,
  solToLamports,
  type WithdrawalDto,
  type WithdrawalPolicyDto,
  type WithdrawalStatus,
  type WithdrawalValidationDto,
} from '@wallet/shared';
import { TransactionRejectedError, type BlockchainProvider } from '../blockchain/types.js';
import { withTransaction } from '../db/transaction.js';
import { AppError, Errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { WalletAccount } from '../repositories/walletAccountRepository.js';
import type { LedgerService } from './ledgerService.js';
import type { WalletKeyStore } from './walletKeyStore.js';
import type { WalletService } from './walletService.js';

/** Base fee for a single-signature transfer on Solana (no priority fee is added). */
export const ESTIMATED_TRANSFER_FEE_LAMPORTS = 5_000n;
/** A withdrawal still unsigned after this long was interrupted; its hold is released. */
const UNSIGNED_TIMEOUT_MS = 2 * 60_000;

export interface WithdrawalPolicy {
  enabled: boolean;
  accessCode: string | null;
  maxLamports: bigint;
}

type Issue = WithdrawalValidationDto['issues'][number];

interface WithdrawalRow {
  id: string;
  user_id: string;
  wallet_account_id: string;
  destination_address: string;
  amount_lamports: string;
  fee_lamports: string | null;
  reserved_lamports: string | null;
  signature: string | null;
  status: WithdrawalStatus;
  failure_reason: string | null;
  last_valid_block_height: string | null;
  created_at: Date;
  completed_at: Date | null;
}

const ACTIVE: WithdrawalStatus[] = ['pending', 'processing', 'broadcast', 'confirming'];

/**
 * Real Solana Devnet withdrawals backed by the internal ledger.
 *
 *   validate → reserve funds (row lock + ledger hold, one DB transaction)
 *   → sign (key decrypted only inside WalletKeyStore) → store signature
 *   → broadcast → reconcile: confirming → completed (final ledger debit)
 *                                       → failed (hold released)
 *
 * The signature is persisted BEFORE broadcasting, so a crash at any point
 * leaves a record that reconcile() can resolve from chain state: the hold is
 * released only once the transaction failed or its blockhash expired.
 */
export class WithdrawalService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly wallets: WalletService,
    private readonly ledger: LedgerService,
    private readonly keyStore: WalletKeyStore,
    private readonly blockchain: BlockchainProvider,
    readonly policy: WithdrawalPolicy,
  ) {}

  policyDto(): WithdrawalPolicyDto {
    return {
      enabled: this.policy.enabled,
      accessCodeRequired: this.policy.enabled && this.policy.accessCode !== null,
      maxLamports: this.policy.maxLamports.toString(),
      estimatedFeeLamports: ESTIMATED_TRANSFER_FEE_LAMPORTS.toString(),
    };
  }

  /** Dry run used by the UI: same checks as request(), nothing is reserved or sent. */
  async validate(userId: string, input: { destinationAddress: string; amountSol: string }): Promise<WithdrawalValidationDto> {
    const wallet = await this.wallets.getOrCreateWallet(userId);
    const available = await this.ledger.getAvailableBalance(userId);
    const { destinationAddress, amount, issues } = this.#checkInput(wallet, input);
    if (amount !== null && issues.length === 0 && amount + ESTIMATED_TRANSFER_FEE_LAMPORTS > available) {
      issues.push({ field: 'amountSol', message: 'Amount plus network fee exceeds your available balance' });
    }
    return {
      valid: issues.length === 0,
      destinationAddress,
      amountLamports: amount?.toString() ?? null,
      estimatedFeeLamports: ESTIMATED_TRANSFER_FEE_LAMPORTS.toString(),
      availableLamports: available.toString(),
      issues,
      broadcastEnabled: this.policy.enabled,
    };
  }

  /**
   * Executes a withdrawal. Idempotent per (user, idempotencyKey): a repeated
   * submission returns the original withdrawal and never sends twice.
   */
  async request(
    userId: string,
    input: { destinationAddress: string; amountSol: string },
    idempotencyKey: string,
  ): Promise<WithdrawalDto> {
    if (!this.policy.enabled) throw Errors.withdrawalsDisabled();
    const wallet = await this.wallets.getOrCreateWallet(userId);

    const existing = await this.#findByIdempotencyKey(userId, idempotencyKey);
    if (existing) return this.toDto(existing);

    const { destinationAddress, amount, issues } = this.#checkInput(wallet, input);
    if (amount === null || issues.length) throw Errors.invalidWithdrawal(issues);
    const fee = ESTIMATED_TRANSFER_FEE_LAMPORTS;
    const reserved = amount + fee;

    await this.#checkNetworkConstraints(wallet, destinationAddress, amount, reserved);

    // 1. Reserve funds atomically. The user row lock serializes concurrent withdrawals.
    const row = await withTransaction(this.pool, async (db) => {
      await this.ledger.lockUser(db, userId);
      const available = await this.ledger.getAvailableBalance(userId, db);
      if (available < reserved) throw Errors.insufficientFunds(available);
      const { rows } = await db.query<WithdrawalRow>(
        `INSERT INTO withdrawals (user_id, wallet_account_id, destination_address, amount_lamports,
                                  fee_lamports, reserved_lamports, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [userId, wallet.id, destinationAddress, amount.toString(), fee.toString(), reserved.toString(), idempotencyKey],
      );
      const created = rows[0];
      if (created) await this.ledger.reserveWithdrawal(db, { userId, withdrawalId: created.id, reserved });
      return created ?? null;
    });
    if (!row) {
      const duplicate = await this.#findByIdempotencyKey(userId, idempotencyKey);
      if (!duplicate) throw new Error('Withdrawal idempotency conflict without a stored withdrawal');
      return this.toDto(duplicate);
    }

    // 2. Sign; persist the signature before anything is sent.
    let signed;
    try {
      signed = await this.keyStore.withSecretKey(wallet, (secretKey) =>
        this.blockchain.createSignedTransfer({ secretKey, destination: destinationAddress, lamports: amount }),
      );
    } catch (error) {
      await this.#fail(row.id, `Signing failed: ${errorMessage(error)}`);
      throw error instanceof AppError ? error : Errors.blockchainUnavailable();
    }
    await this.pool.query(
      `UPDATE withdrawals SET signature = $2, last_valid_block_height = $3, status = 'processing', updated_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [row.id, signed.signature, signed.lastValidBlockHeight],
    );

    // 3. Broadcast.
    try {
      await this.blockchain.sendRawTransaction(signed.serialized);
      await this.pool.query(
        `UPDATE withdrawals SET status = 'broadcast', broadcast_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [row.id],
      );
      logger.info('Withdrawal broadcast', { userId, withdrawalId: row.id, signature: signed.signature });
    } catch (error) {
      if (error instanceof TransactionRejectedError) {
        await this.#fail(row.id, `Rejected by the network: ${error.message}`);
      } else {
        // Ambiguous (timeout/network): it may still land. reconcile() decides from chain state.
        logger.warn('Withdrawal broadcast outcome unknown', { withdrawalId: row.id, error: errorMessage(error) });
      }
    }
    return this.toDto(await this.#getRow(row.id));
  }

  async get(userId: string, withdrawalId: string): Promise<WithdrawalDto> {
    const { rows } = await this.pool.query<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = $1 AND user_id = $2', [
      withdrawalId,
      userId,
    ]);
    if (!rows[0]) throw Errors.notFound('Withdrawal not found');
    return this.toDto(rows[0]);
  }

  /** Resolves in-flight withdrawals of a wallet from chain state. Safe to run concurrently. */
  async reconcile(wallet: WalletAccount): Promise<void> {
    const { rows } = await this.pool.query<WithdrawalRow>(
      'SELECT * FROM withdrawals WHERE wallet_account_id = $1 AND status = ANY($2)',
      [wallet.id, ACTIVE],
    );
    if (rows.length === 0) return;

    const signed = rows.filter((r) => r.signature);
    const statuses = await this.blockchain.getSignatureStatuses(signed.map((r) => r.signature!));
    let blockHeight: number | undefined;

    for (const row of rows) {
      if (!row.signature) {
        if (Date.now() - row.created_at.getTime() > UNSIGNED_TIMEOUT_MS) {
          await this.#fail(row.id, 'Interrupted before the transaction was signed');
        }
        continue;
      }
      const status = statuses.get(row.signature) ?? null;
      if (status?.failed) {
        const landed = await this.blockchain.getTransaction(row.signature);
        await this.#fail(row.id, `Transaction failed on-chain: ${status.error ?? 'unknown error'}`, landed?.feeLamports);
      } else if (status?.status === 'finalized') {
        const details = await this.blockchain.getTransaction(row.signature);
        await this.#complete(row.id, details?.feeLamports ?? BigInt(row.fee_lamports ?? ESTIMATED_TRANSFER_FEE_LAMPORTS));
      } else if (status) {
        await this.pool.query(
          `UPDATE withdrawals SET status = 'confirming', updated_at = now()
           WHERE id = $1 AND status IN ('processing', 'broadcast')`,
          [row.id],
        );
      } else if (row.last_valid_block_height) {
        blockHeight ??= await this.blockchain.getBlockHeight();
        if (blockHeight > Number(row.last_valid_block_height)) {
          await this.#fail(row.id, 'Transaction expired before it was confirmed');
        }
      }
    }
  }

  toDto(row: WithdrawalRow): WithdrawalDto {
    return {
      id: row.id,
      destinationAddress: row.destination_address,
      amountLamports: row.amount_lamports,
      feeLamports: row.fee_lamports,
      status: row.status,
      signature: row.signature,
      explorerUrl: row.signature ? this.blockchain.explorerUrl('tx', row.signature) : null,
      failureReason: row.failure_reason,
      createdAt: row.created_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
    };
  }

  #checkInput(wallet: WalletAccount, input: { destinationAddress: string; amountSol: string }) {
    const issues: Issue[] = [];
    const destinationAddress = input.destinationAddress.trim();
    if (!this.blockchain.isValidAddress(destinationAddress)) {
      issues.push({ field: 'destinationAddress', message: 'Not a valid Solana address' });
    } else if (destinationAddress === wallet.address) {
      issues.push({ field: 'destinationAddress', message: 'Destination is this wallet’s own address' });
    }

    let amount: bigint | null = null;
    try {
      amount = solToLamports(input.amountSol);
      if (amount <= 0n) {
        issues.push({ field: 'amountSol', message: 'Amount must be greater than zero' });
      } else if (amount > this.policy.maxLamports) {
        issues.push({
          field: 'amountSol',
          message: `Demo limit: at most ${lamportsToSol(this.policy.maxLamports).replace(/\.?0+$/, '')} SOL per withdrawal`,
        });
      }
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      issues.push({ field: 'amountSol', message: 'Enter a positive SOL amount with up to 9 decimal places' });
    }
    return { destinationAddress, amount, issues };
  }

  /** On-chain feasibility: fee coverage and Solana rent-exemption rules. */
  async #checkNetworkConstraints(wallet: WalletAccount, destination: string, amount: bigint, reserved: bigint) {
    const [onChain, rentMinimum, destinationBalance] = await Promise.all([
      this.blockchain.getBalance(wallet.address),
      this.blockchain.getMinimumBalanceForRentExemption(),
      this.blockchain.getBalance(destination),
    ]);
    const sol = (lamports: bigint) => lamportsToSol(lamports).replace(/\.?0+$/, '');
    if (onChain < reserved) {
      throw Errors.insufficientNetworkFunds(
        'The custodial wallet does not hold enough SOL on-chain for this amount plus the network fee.',
      );
    }
    const remaining = onChain - reserved;
    if (remaining > 0n && remaining < rentMinimum) {
      throw Errors.insufficientNetworkFunds(
        `This would leave less than the rent-exempt minimum (${sol(rentMinimum)} SOL) in the wallet. Withdraw a smaller amount.`,
      );
    }
    if (destinationBalance === 0n && amount < rentMinimum) {
      throw Errors.invalidWithdrawal([
        { field: 'amountSol', message: `The destination is a new account: send at least ${sol(rentMinimum)} SOL.` },
      ]);
    }
  }

  async #complete(withdrawalId: string, fee: bigint): Promise<void> {
    await withTransaction(this.pool, async (db) => {
      const row = await this.#lockRow(db, withdrawalId);
      if (!row || !ACTIVE.includes(row.status)) return;
      await this.ledger.completeWithdrawal(db, {
        userId: row.user_id,
        withdrawalId: row.id,
        reserved: BigInt(row.reserved_lamports ?? '0'),
        amount: BigInt(row.amount_lamports),
        fee,
      });
      await db.query(
        `UPDATE withdrawals SET status = 'completed', fee_lamports = $2, completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [withdrawalId, fee.toString()],
      );
    });
    logger.info('Withdrawal completed', { withdrawalId });
  }

  async #fail(withdrawalId: string, reason: string, chargedFee?: bigint): Promise<void> {
    await withTransaction(this.pool, async (db) => {
      const row = await this.#lockRow(db, withdrawalId);
      if (!row || !ACTIVE.includes(row.status)) return;
      await this.ledger.releaseFailedWithdrawal(db, {
        userId: row.user_id,
        withdrawalId: row.id,
        reserved: BigInt(row.reserved_lamports ?? '0'),
        chargedFee,
      });
      await db.query(
        `UPDATE withdrawals SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`,
        [withdrawalId, reason.slice(0, 500)],
      );
    });
    logger.warn('Withdrawal failed', { withdrawalId, reason });
  }

  async #lockRow(db: pg.PoolClient, id: string): Promise<WithdrawalRow | null> {
    const { rows } = await db.query<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] ?? null;
  }

  async #getRow(id: string): Promise<WithdrawalRow> {
    const { rows } = await this.pool.query<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = $1', [id]);
    if (!rows[0]) throw Errors.notFound('Withdrawal not found');
    return rows[0];
  }

  async #findByIdempotencyKey(userId: string, key: string): Promise<WithdrawalRow | null> {
    const { rows } = await this.pool.query<WithdrawalRow>(
      'SELECT * FROM withdrawals WHERE user_id = $1 AND idempotency_key = $2',
      [userId, key],
    );
    return rows[0] ?? null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
