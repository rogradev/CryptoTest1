import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgWalletAccountRepository } from '../src/repositories/walletAccountRepository.js';
import { PgUserRepository } from '../src/repositories/userRepository.js';
import { SecretCipher } from '../src/lib/secretCipher.js';
import { WalletService } from '../src/services/walletService.js';
import { MockBlockchainProvider, testKey } from './helpers.js';
import { adminUrl, createScratchDatabase } from './support/scratchDb.js';

/** Integration test against a real PostgreSQL (scratch database, see support/scratchDb.ts). */
describe.skipIf(!adminUrl)('PgWalletAccountRepository (PostgreSQL)', () => {
  const userId = 'repo-test-user';
  let db: Awaited<ReturnType<typeof createScratchDatabase>>;

  beforeAll(async () => {
    db = await createScratchDatabase([userId]);
  });
  afterAll(() => db.drop());

  it('persists the wallet and retrieves the same one from a fresh service instance', async () => {
    const key = testKey();
    const make = () =>
      new WalletService(new PgUserRepository(db.pool), new PgWalletAccountRepository(db.pool), new MockBlockchainProvider(), new SecretCipher(key));

    const created = await make().getOrCreateWallet(userId);
    const [a, b] = await Promise.all([make().getOrCreateWallet(userId), make().getOrCreateWallet(userId)]);
    expect(a.address).toBe(created.address);
    expect(b.address).toBe(created.address);

    const { rows } = await db.pool.query('SELECT count(*)::int AS n, min(encrypted_secret) AS s FROM wallet_accounts WHERE user_id = $1', [userId]);
    expect(rows[0].n).toBe(1);
    expect(rows[0].s).toMatch(/^v1\./);
  });
});
