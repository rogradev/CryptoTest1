import type pg from 'pg';

export interface Migration {
  name: string;
  sql: string;
}

/** Arbitrary constant identifying the migration lock. */
const MIGRATION_LOCK_ID = 727274;

/**
 * Minimal forward-only migration runner.
 *
 * Every step runs in its own transaction holding a transaction-scoped advisory
 * lock, so concurrent runners (several serverless instances cold-starting at
 * once) serialize safely. Transaction-scoped locks are released on COMMIT or
 * ROLLBACK, which keeps this safe behind transaction-mode poolers (e.g. Neon,
 * PgBouncer) where a session-level lock could be left dangling.
 */
export async function runMigrations(client: pg.ClientBase, migrations: readonly Migration[]): Promise<string[]> {
  await inLockedTransaction(client, () =>
    client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`),
  );

  const applied: string[] = [];
  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    const ran = await inLockedTransaction(client, async () => {
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migration.name]);
      if (rowCount) return false;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
      return true;
    }).catch((error: unknown) => {
      throw new Error(`Migration ${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (ran) applied.push(migration.name);
  }
  return applied;
}

async function inLockedTransaction<T>(client: pg.ClientBase, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** Creates a user if missing. Idempotent. Returns true when a row was inserted. */
export async function seedUser(db: Pick<pg.ClientBase, 'query'>, id: string, displayName: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [id, displayName],
  );
  return Boolean(rowCount);
}
