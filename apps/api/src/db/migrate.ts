import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { z } from 'zod';
import { loadEnv, repoRoot } from '../config/env.js';

/**
 * Minimal forward-only SQL migration runner.
 * Applies database/migrations/*.sql in filename order, each in its own
 * transaction, and records them in schema_migrations.
 */
const migrationsDir = path.join(repoRoot, 'database', 'migrations');

export async function runMigrations(client: pg.ClientBase): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      newlyApplied.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return newlyApplied;
}

async function main() {
  // Migrations need only the database URL.
  const databaseUrl = z
    .string({ error: 'DATABASE_URL is required (see .env.example)' })
    .min(1)
    .parse(loadEnvSafe() ?? process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    const applied = await runMigrations(client);
    console.log(applied.length ? `Applied migrations:\n  ${applied.join('\n  ')}` : 'Database is up to date.');
  } finally {
    await client.end();
  }
}

function loadEnvSafe(): string | undefined {
  try {
    return loadEnv().DATABASE_URL;
  } catch {
    return undefined;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
