import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { createContainer, createHttpApp } from '../src/container.js';
import { MockBlockchainProvider } from './helpers.js';

/**
 * Integration test: a brand-new, empty database is migrated and seeded by the
 * API itself on the first request (the serverless deployment path).
 * Runs only when TEST_ADMIN_DATABASE_URL points at a server where the test may
 * create and drop a scratch database.
 */
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;

describe.skipIf(!adminUrl)('database auto-bootstrap', () => {
  const dbName = `wallet_bootstrap_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  let pool: pg.Pool;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  });

  it('creates the schema and demo user on first request, then serves the wallet', async () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://unused/for-pool-injection',
      WALLET_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });
    const app = createHttpApp(env, createContainer(env, pool, new MockBlockchainProvider()));

    // Concurrent first requests, like several cold starts at once.
    const [me, wallet, again] = await Promise.all([
      request(app).get('/api/me'),
      request(app).get('/api/wallet'),
      request(app).get('/api/wallet'),
    ]);
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe('demo-user-001');
    expect(wallet.status).toBe(200);
    expect(again.body.data.address).toBe(wallet.body.data.address);

    const { rows } = await pool.query('SELECT name FROM schema_migrations');
    expect(rows.map((r) => r.name)).toEqual(['001_initial_schema.sql']);
    const { rows: wallets } = await pool.query('SELECT count(*)::int AS n FROM wallet_accounts');
    expect(wallets[0].n).toBe(1);
  });
});
