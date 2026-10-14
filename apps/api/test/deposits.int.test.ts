import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomAddress } from './helpers.js';
import { adminUrl, createScratchDatabase } from './support/scratchDb.js';
import { buildServices, SOL } from './support/services.js';

const USER = 'demo-user-001';
const FAUCET = randomAddress();

describe.skipIf(!adminUrl)('deposit detection (PostgreSQL + fake chain)', () => {
  let db: Awaited<ReturnType<typeof createScratchDatabase>>;
  let s: ReturnType<typeof buildServices>;
  let address: string;

  beforeEach(async () => {
    db = await createScratchDatabase();
    s = buildServices(db.pool);
    address = (await s.wallets.getOrCreateWallet(USER)).address;
  });
  afterEach(() => db.drop());

  const count = async (sql: string) => Number((await db.pool.query(sql)).rows[0].n);

  it('imports an already-finalized deposit and credits the ledger exactly once', async () => {
    s.chain.addTransfer({ from: FAUCET, to: address, lamports: 5n * SOL, status: 'finalized' });

    const first = await s.sync.syncUser(USER);
    expect(first).toEqual({ status: 'ok', imported: 1, credited: 1 });
    expect(await s.ledger.getAvailableBalance(USER)).toBe(5n * SOL);

    const { rows } = await db.pool.query('SELECT status, amount_lamports FROM deposits');
    expect(rows).toEqual([{ status: 'confirmed', amount_lamports: '5000000000' }]);
  });

  it('never processes the same signature twice: repeated, concurrent and post-restart syncs', async () => {
    s.chain.addTransfer({ from: FAUCET, to: address, lamports: 5n * SOL });
    await s.sync.syncUser(USER);
    await s.sync.syncUser(USER);
    await Promise.all([s.sync.syncUser(USER), s.sync.syncUser(USER), s.sync.syncUser(USER)]);

    // "Restart": brand-new service instances over the same database.
    const restarted = buildServices(db.pool, { chain: s.chain });
    await restarted.sync.syncUser(USER);

    expect(await count('SELECT count(*) n FROM blockchain_transactions')).toBe(1);
    expect(await count('SELECT count(*) n FROM deposits')).toBe(1);
    expect(await count("SELECT count(*) n FROM ledger_entries WHERE type = 'deposit'")).toBe(1);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(5n * SOL);
  });

  it('follows commitment: detected → confirming → confirmed, crediting only at finalized', async () => {
    const sig = s.chain.addTransfer({ from: FAUCET, to: address, lamports: 2n * SOL, status: 'processed' });
    const status = async () => (await db.pool.query('SELECT status FROM deposits WHERE signature = $1', [sig])).rows[0]?.status;

    await s.sync.syncUser(USER);
    expect(await status()).toBe('detected');
    expect(await s.ledger.getAvailableBalance(USER)).toBe(0n);

    s.chain.setStatus(sig, 'confirmed');
    await s.sync.syncUser(USER);
    expect(await status()).toBe('confirming');
    expect(await s.ledger.getAvailableBalance(USER)).toBe(0n);

    const overview = await s.account.getOverview(USER);
    expect(overview.pending.incomingLamports).toBe((2n * SOL).toString());

    s.chain.setStatus(sig, 'finalized');
    await s.sync.syncUser(USER);
    expect(await status()).toBe('confirmed');
    expect(await s.ledger.getAvailableBalance(USER)).toBe(2n * SOL);

    const { rows } = await db.pool.query('SELECT status FROM blockchain_transactions WHERE signature = $1', [sig]);
    expect(rows[0].status).toBe('finalized');
  });

  it('marks failed transactions as failed and never credits them', async () => {
    s.chain.addTransfer({ from: FAUCET, to: address, lamports: SOL, failed: true });
    await s.sync.syncUser(USER);
    const { rows } = await db.pool.query('SELECT status FROM deposits');
    expect(rows).toEqual([{ status: 'failed' }]);
    expect(await s.ledger.getAvailableBalance(USER)).toBe(0n);
  });

  it('a transaction that fails after being detected moves to failed without credit', async () => {
    const sig = s.chain.addTransfer({ from: FAUCET, to: address, lamports: SOL, status: 'confirmed' });
    await s.sync.syncUser(USER);
    s.chain.setStatus(sig, 'finalized', true);
    await s.sync.syncUser(USER);
    expect((await db.pool.query('SELECT status FROM deposits')).rows[0].status).toBe('failed');
    expect(await s.ledger.getAvailableBalance(USER)).toBe(0n);
  });

  it('ignores outgoing and unrelated transfers as deposits but records them', async () => {
    s.chain.addTransfer({ from: FAUCET, to: address, lamports: 3n * SOL });
    s.chain.addTransfer({ from: address, to: randomAddress(), lamports: SOL });
    await s.sync.syncUser(USER);
    expect(await count('SELECT count(*) n FROM deposits')).toBe(1);
    const { rows } = await db.pool.query('SELECT direction FROM blockchain_transactions ORDER BY slot, direction');
    expect(rows.map((r) => r.direction).sort()).toEqual(['inbound', 'outbound']);
  });

  it('throttles syncs across callers with minIntervalMs', async () => {
    await s.sync.syncUser(USER);
    s.chain.addTransfer({ from: FAUCET, to: address, lamports: SOL });
    expect((await s.sync.syncUser(USER, { minIntervalMs: 60_000 })).status).toBe('skipped');
    expect((await s.sync.syncUser(USER, { minIntervalMs: 0 })).imported).toBe(1);
  });

  it('exposes stored deposits in the activity history', async () => {
    const sig = s.chain.addTransfer({ from: FAUCET, to: address, lamports: 5n * SOL });
    await s.sync.syncUser(USER);
    const [item] = await s.account.getActivity(USER, 10);
    expect(item).toMatchObject({ kind: 'deposit', amountLamports: '5000000000', status: 'confirmed', signature: sig });
    expect(item!.explorerUrl).toBe(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  });
});
