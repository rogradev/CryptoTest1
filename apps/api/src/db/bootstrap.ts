import type pg from 'pg';
import { logger } from '../lib/logger.js';
import { MIGRATIONS } from './migrations.generated.js';
import { runMigrations, seedUser } from './migrations.js';

/**
 * Prepares the database on first use: applies pending migrations and, while
 * the demo identity is in use, ensures the demo user exists. Runs once per
 * process (serverless instance); a failure is retried on the next request.
 */
export function createDatabaseBootstrap(pool: pg.Pool, options: { demoUserId?: string }) {
  let ready: Promise<void> | null = null;

  const bootstrap = async () => {
    const client = await pool.connect();
    try {
      const applied = await runMigrations(client, MIGRATIONS);
      if (applied.length) logger.info('Applied database migrations', { applied });
      if (options.demoUserId && (await seedUser(client, options.demoUserId, 'Demo User'))) {
        logger.info('Seeded demo user', { userId: options.demoUserId });
      }
    } finally {
      client.release();
    }
  };

  return function ensureDatabaseReady(): Promise<void> {
    ready ??= bootstrap().catch((error: unknown) => {
      ready = null;
      throw error;
    });
    return ready;
  };
}
