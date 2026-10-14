import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { MIGRATIONS } from '../../src/db/migrations.generated.js';
import { runMigrations, seedUser } from '../../src/db/migrations.js';

/**
 * Real-PostgreSQL test support. Tests using it run only when
 * TEST_ADMIN_DATABASE_URL points at a server where they may create and drop
 * scratch databases (e.g. postgresql://wallet:wallet@localhost:5432/postgres).
 */
export const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;

export async function createScratchDatabase(users: string[] = ['demo-user-001']) {
  const name = `wallet_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl!);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
  const client = await pool.connect();
  try {
    await runMigrations(client, MIGRATIONS);
    for (const id of users) await seedUser(client, id, id);
  } finally {
    client.release();
  }
  return {
    pool,
    async drop() {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      await admin.end();
    },
  };
}
