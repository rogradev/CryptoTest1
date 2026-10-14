import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { randomAddress } from './helpers.js';
import { adminUrl, createScratchDatabase } from './support/scratchDb.js';
import { buildServices, FEE, SOL } from './support/services.js';

const USER = 'demo-user-001';
const FAUCET = randomAddress();
let keySeq = 0;
const key = () => `test-key-${Date.now()}-${keySeq++}`;

describe.skipIf(!adminUrl)('withdrawals and ledger (PostgreSQL + fake chain)', () => {
  let db: Awaited<ReturnType<typeof createScratchDatabase>>;
  let s: ReturnType<typeof buildServices>;
  let address: string;
  const dest = randomAddress();

  /** Funds the wallet on-chain and credits the ledger through the real deposit path. */
  async function fund(lamports: bigint) {
    s.chain.addTransfer({ from: FAUCET, to: address, lamports });
    await s.sync.syncUser(USER);
  }
  const withdraw = (amountSol: string, idempotencyKey = key(), destinationAddress = dest) =>
    s.withdrawals.request(USER, { destinationAddress, amountSol }, idempotencyKey);
  const ledgerTypes = async (withdrawalId: string) =>
    (
      await db.pool.query('SELECT type, amount_lamports FROM ledger_entries WHERE reference_id = $1 ORDER BY created_at, type', [
        withdrawalId,
      ])
    ).rows.map((r) => `${r.type}:${r.amount_lamports}`);

  beforeEach(async () => {
    db = await createScratchDatabase();
    s = buildServices(db.pool);
    address = (await s.wallets.getOrCreateWallet(USER)).address;
    s.chain.balances.set(dest, 1n); // existing destination account (no rent-exempt minimum needed)
  });
  afterEach(() => db.drop());

  it('reserves funds, signs and broadcasts', async () => {
    await fund(5n * SOL);
    const w = await withdraw('1');
    expect(w.status).toBe('broadcast');
    expect(w.signature).toBeTruthy();
    expect(w.explorerUrl).toContain('cluster=devnet');
    expect(s.chain.sentSignatures).toEqual([w.signature]);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(5n * SOL - SOL - FEE);
    expect(await ledgerTypes(w.id)).toEqual([`withdrawal_reserve:-${SOL + FEE}`]);
  });

  it('completes on finalization: release + final debit + actual fee, then balance decreases', async () => {
    await fund(5n * SOL);
    const w = await withdraw('1');

    s.chain.setStatus(w.signature!, 'confirmed');
    await s.sync.syncUser(USER);
    expect((await s.withdrawals.get(USER, w.id)).status).toBe('confirming');

    s.chain.setStatus(w.signature!, 'finalized');
    await s.sync.syncUser(USER);
    const done = await s.withdrawals.get(USER, w.id);
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeTruthy();
    expect((await ledgerTypes(w.id)).sort()).toEqual(
      [`withdrawal_reserve:-${SOL + FEE}`, `withdrawal_release:${SOL + FEE}`, `withdrawal:-${SOL}`, `withdrawal_fee:-${FEE}`].sort(),
    );
    expect(await s.ledger.getAvailableBalance(USER)).toBe(4n * SOL - FEE);

    // Re-running reconciliation never posts twice.
    await s.sync.syncUser(USER);
    await s.withdrawals.reconcile(await s.wallets.getOrCreateWallet(USER));
    expect(await ledgerTypes(w.id)).toHaveLength(4);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(4n * SOL - FEE);

    // History shows both, newest first.
    const activity = await s.account.getActivity(USER, 10);
    expect(activity.map((a) => `${a.kind}:${a.amountLamports}:${a.status}`)).toEqual([
      `withdrawal:-${SOL}:completed`,
      `deposit:${5n * SOL}:confirmed`,
    ]);
  });

  it('the outgoing withdrawal transaction is never imported as a deposit', async () => {
    await fund(5n * SOL);
    const w = await withdraw('1');
    s.chain.setStatus(w.signature!, 'finalized');
    await s.sync.syncUser(USER);
    expect(Number((await db.pool.query('SELECT count(*) n FROM deposits')).rows[0].n)).toBe(1);
  });

  it('releases the hold when the network rejects the transaction', async () => {
    await fund(2n * SOL);
    s.chain.sendBehavior = 'reject';
    const w = await withdraw('1');
    expect(w.status).toBe('failed');
    expect(w.failureReason).toMatch(/Rejected by the network/);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(2n * SOL);
    expect((await ledgerTypes(w.id)).sort()).toEqual([`withdrawal_release:${SOL + FEE}`, `withdrawal_reserve:-${SOL + FEE}`]);
  });

  it('keeps an ambiguous broadcast in flight, then releases it after the blockhash expires', async () => {
    await fund(2n * SOL);
    s.chain.sendBehavior = 'ambiguous';
    const w = await withdraw('1');
    expect(w.status).toBe('processing');
    expect(await s.ledger.getAvailableBalance(USER)).toBe(SOL - FEE);

    await s.sync.syncUser(USER); // not found, blockhash still valid → keep waiting
    expect((await s.withdrawals.get(USER, w.id)).status).toBe('processing');

    s.chain.blockHeight += 1_000; // past lastValidBlockHeight
    await s.sync.syncUser(USER);
    const failed = await s.withdrawals.get(USER, w.id);
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toMatch(/expired/);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(2n * SOL);
  });

  it('a transaction that lands but fails releases the hold and charges only the network fee', async () => {
    await fund(2n * SOL);
    const w = await withdraw('1');
    s.chain.setStatus(w.signature!, 'finalized', true);
    await s.sync.syncUser(USER);
    expect((await s.withdrawals.get(USER, w.id)).status).toBe('failed');
    expect(await s.ledger.getAvailableBalance(USER)).toBe(2n * SOL - FEE);
  });

  it('rejects amounts above the internal available balance without reserving anything', async () => {
    await fund(SOL);
    s.chain.balances.set(address, 10n * SOL); // on-chain has plenty; the ledger is the limit
    await expect(withdraw('1')).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(Number((await db.pool.query('SELECT count(*) n FROM withdrawals')).rows[0].n)).toBe(0);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(SOL);
  });

  it('concurrent withdrawals cannot spend the same balance', async () => {
    await fund(SOL);
    s.chain.balances.set(address, 100n * SOL); // on-chain is no constraint: only the ledger lock protects
    const results = await Promise.allSettled([withdraw('0.6'), withdraw('0.6'), withdraw('0.6')]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected.map((r) => (r.reason as AppError).code)).toEqual(['INSUFFICIENT_FUNDS', 'INSUFFICIENT_FUNDS']);
    expect(s.chain.sentSignatures).toHaveLength(1);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(SOL - (600_000_000n + FEE));
  });

  it('duplicate submissions with the same idempotency key send once', async () => {
    await fund(3n * SOL);
    const k = key();
    const [a, b] = await Promise.all([withdraw('1', k), withdraw('1', k)]);
    const c = await withdraw('1', k);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(s.chain.sentSignatures).toHaveLength(1);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(2n * SOL - FEE);
  });

  it.each([
    ['not-a-solana-address', '0.1', 'destinationAddress'],
    ['0x742d35Cc6634C0532925a3b844Bc454e4438f44e', '0.1', 'destinationAddress'],
  ])('rejects invalid address %s', async (destinationAddress, amountSol, field) => {
    await fund(SOL);
    await expect(withdraw(amountSol, key(), destinationAddress)).rejects.toMatchObject({
      code: 'INVALID_WITHDRAWAL',
      details: [expect.objectContaining({ field })],
    });
  });

  it('rejects the wallet’s own address', async () => {
    await fund(SOL);
    await expect(withdraw('0.1', key(), address)).rejects.toMatchObject({ code: 'INVALID_WITHDRAWAL' });
  });

  it.each(['0', '-1', 'abc', '0.0000000001', '1e3', '3'])('rejects invalid amount %s', async (amountSol) => {
    await fund(5n * SOL);
    await expect(withdraw(amountSol)).rejects.toMatchObject({
      code: 'INVALID_WITHDRAWAL',
      details: [expect.objectContaining({ field: 'amountSol' })],
    });
    expect(s.chain.sentSignatures).toHaveLength(0);
  });

  it('refuses when the wallet lacks on-chain SOL for amount + fee', async () => {
    await fund(SOL);
    s.chain.balances.set(address, SOL); // exactly 1 SOL on-chain: no room for the fee
    await expect(withdraw('1')).rejects.toMatchObject({ code: 'INSUFFICIENT_NETWORK_FUNDS' });
  });

  it('refuses to leave the wallet below the rent-exempt minimum', async () => {
    await fund(SOL);
    await expect(withdraw('0.9999')).rejects.toMatchObject({ code: 'INSUFFICIENT_NETWORK_FUNDS' });
  });

  it('refuses tiny amounts to a brand-new destination account', async () => {
    await fund(SOL);
    await expect(withdraw('0.0001', key(), randomAddress())).rejects.toMatchObject({ code: 'INVALID_WITHDRAWAL' });
  });

  it('refuses everything when withdrawals are disabled', async () => {
    const disabled = buildServices(db.pool, { chain: s.chain, policy: { enabled: false } });
    await expect(disabled.withdrawals.request(USER, { destinationAddress: dest, amountSol: '0.1' }, key())).rejects.toMatchObject({
      code: 'WITHDRAWALS_DISABLED',
    });
  });

  it('validate() reports issues against the ledger balance without reserving', async () => {
    await fund(SOL);
    const ok = await s.withdrawals.validate(USER, { destinationAddress: dest, amountSol: '0.5' });
    expect(ok).toMatchObject({ valid: true, availableLamports: SOL.toString(), broadcastEnabled: true });
    const tooMuch = await s.withdrawals.validate(USER, { destinationAddress: dest, amountSol: '1' });
    expect(tooMuch.valid).toBe(false);
    expect(Number((await db.pool.query('SELECT count(*) n FROM withdrawals')).rows[0].n)).toBe(0);
  });

  it('ledger entries are immutable', async () => {
    await fund(SOL);
    await expect(db.pool.query('UPDATE ledger_entries SET amount_lamports = 1')).rejects.toThrow(/append-only/);
    await expect(db.pool.query('DELETE FROM ledger_entries')).rejects.toThrow(/append-only/);
  });

  it('ledger postings are idempotent per reference', async () => {
    await fund(SOL);
    const { rows } = await db.pool.query('SELECT id FROM deposits');
    const again = await s.ledger.creditDeposit(db.pool, { userId: USER, depositId: rows[0].id, amount: SOL });
    expect(again).toBe(false);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(SOL);
  });

  it('the overview shows ledger balance, on-chain balance and in-flight amounts', async () => {
    await fund(5n * SOL);
    await withdraw('1');
    const o = await s.account.getOverview(USER);
    expect(o.available.lamports).toBe((4n * SOL - FEE).toString());
    expect(o.pending.outgoingLamports).toBe((SOL + FEE).toString());
    expect(o.onChain).not.toBeNull();
    expect(o.withdrawals).toMatchObject({ enabled: true, accessCodeRequired: false });
  });
});
