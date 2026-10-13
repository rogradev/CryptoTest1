import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgWalletAccountRepository } from '../src/repositories/walletAccountRepository.js';
import { PgUserRepository } from '../src/repositories/userRepository.js';
import { SecretCipher } from '../src/lib/secretCipher.js';
import { WalletService } from '../src/services/walletService.js';
import { MockBlockchainProvider, testKey } from './helpers.js';

/**
 * Integration test against a real PostgreSQL (migrated schema required).
 * Runs only when TEST_DATABASE_URL is set; skipped otherwise.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PgWalletAccountRepository (PostgreSQL)', () => {
  const pool = new pg.Pool({ connectionString: url });
  const userId = `test-user-${Date.now()}`;

  beforeAll(async () => {
    await pool.query('INSERT INTO users (id, display_name) VALUES ($1, $2)', [userId, 'Integration Test']);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM wallet_accounts WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.end();
  });

  it('persists the wallet and retrieves the same one from a fresh service instance', async () => {
    const key = testKey();
    const make = () =>
      new WalletService(new PgUserRepository(pool), new PgWalletAccountRepository(pool), new MockBlockchainProvider(), new SecretCipher(key));

    const created = await make().getOrCreateWallet(userId);
    const [a, b] = await Promise.all([make().getOrCreateWallet(userId), make().getOrCreateWallet(userId)]);
    expect(a.address).toBe(created.address);
    expect(b.address).toBe(created.address);

    const { rows } = await pool.query('SELECT count(*)::int AS n, min(encrypted_secret) AS s FROM wallet_accounts WHERE user_id = $1', [userId]);
    expect(rows[0].n).toBe(1);
    expect(rows[0].s).toMatch(/^v1\./);
  });
});
