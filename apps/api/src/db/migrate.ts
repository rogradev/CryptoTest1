import pg from 'pg';
import { loadDatabaseEnv } from '../config/env.js';
import { MIGRATIONS } from './migrations.generated.js';
import { runMigrations } from './migrations.js';

/** CLI: applies pending migrations (embedded from database/migrations). */
async function main() {
  const { DATABASE_URL } = loadDatabaseEnv();
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const applied = await runMigrations(client, MIGRATIONS);
    console.log(applied.length ? `Applied migrations:\n  ${applied.join('\n  ')}` : 'Database is up to date.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
