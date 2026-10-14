import type pg from 'pg';
import type { Queryable } from '../db/transaction.js';

type EntryType = 'deposit' | 'withdrawal' | 'withdrawal_fee' | 'withdrawal_reserve' | 'withdrawal_release' | 'adjustment';

/**
 * Internal ledger — the source of truth for a user's application balance.
 *
 * Entries are append-only (enforced by a database trigger) and amounts are
 * signed integer lamports. Available balance = SUM(amount_lamports).
 * The UNIQUE (reference_type, reference_id, type) constraint makes every
 * posting idempotent: retrying a step can never double-credit or double-debit.
 *
 * Methods that change a balance take the caller's transaction client so they
 * commit atomically with the deposit/withdrawal status change they belong to.
 */
export class LedgerService {
  constructor(private readonly pool: pg.Pool) {}

  async getAvailableBalance(userId: string, db: Queryable = this.pool): Promise<bigint> {
    const { rows } = await db.query<{ total: string }>(
      'SELECT COALESCE(SUM(amount_lamports), 0)::text AS total FROM ledger_entries WHERE user_id = $1',
      [userId],
    );
    return BigInt(rows[0]?.total ?? '0');
  }

  /**
   * Serializes balance-changing operations for one user (until the transaction
   * ends). Two concurrent withdrawals therefore cannot both spend the same funds.
   */
  async lockUser(db: Queryable, userId: string): Promise<void> {
    const { rowCount } = await db.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!rowCount) throw new Error(`User ${userId} not found`);
  }

  /** Credits a confirmed deposit. Returns false if it was already credited. */
  creditDeposit(db: Queryable, p: { userId: string; depositId: string; amount: bigint }): Promise<boolean> {
    return this.#post(db, p.userId, 'deposit', p.amount, 'deposit', p.depositId);
  }

  /** Holds amount + fee for an in-flight withdrawal. Caller must hold lockUser() and have checked the balance. */
  reserveWithdrawal(db: Queryable, p: { userId: string; withdrawalId: string; reserved: bigint }): Promise<boolean> {
    return this.#post(db, p.userId, 'withdrawal_reserve', -p.reserved, 'withdrawal', p.withdrawalId);
  }

  /** Converts the hold into the final debit: release the hold, debit amount and the actual network fee. */
  async completeWithdrawal(
    db: Queryable,
    p: { userId: string; withdrawalId: string; reserved: bigint; amount: bigint; fee: bigint },
  ): Promise<void> {
    await this.#post(db, p.userId, 'withdrawal_release', p.reserved, 'withdrawal', p.withdrawalId);
    await this.#post(db, p.userId, 'withdrawal', -p.amount, 'withdrawal', p.withdrawalId);
    await this.#post(db, p.userId, 'withdrawal_fee', -p.fee, 'withdrawal', p.withdrawalId);
  }

  /**
   * Returns the held funds of a failed withdrawal. If the failed transaction
   * still landed on-chain, its network fee was charged and is debited.
   */
  async releaseFailedWithdrawal(
    db: Queryable,
    p: { userId: string; withdrawalId: string; reserved: bigint; chargedFee?: bigint },
  ): Promise<void> {
    await this.#post(db, p.userId, 'withdrawal_release', p.reserved, 'withdrawal', p.withdrawalId);
    if (p.chargedFee) await this.#post(db, p.userId, 'withdrawal_fee', -p.chargedFee, 'withdrawal', p.withdrawalId);
  }

  async #post(
    db: Queryable,
    userId: string,
    type: EntryType,
    amount: bigint,
    referenceType: 'deposit' | 'withdrawal',
    referenceId: string,
  ): Promise<boolean> {
    if (amount === 0n) return false;
    const { rowCount } = await db.query(
      `INSERT INTO ledger_entries (user_id, type, amount_lamports, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (reference_type, reference_id, type) DO NOTHING`,
      [userId, type, amount.toString(), referenceType, referenceId],
    );
    return Boolean(rowCount);
  }
}
