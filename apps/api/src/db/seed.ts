import pg from 'pg';
import { loadDatabaseEnv } from '../config/env.js';
import { seedUser } from './migrations.js';

/** CLI: seeds the temporary development user. Safe to run repeatedly. */
async function main() {
  const env = loadDatabaseEnv();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const inserted = await seedUser(client, env.DEMO_USER_ID, 'Demo User');
    console.log(inserted ? `Seeded user ${env.DEMO_USER_ID}` : `User ${env.DEMO_USER_ID} already exists`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
