import pg from 'pg';
import { loadEnv } from '../config/env.js';

/** Seeds the temporary development user. Safe to run repeatedly. */
async function main() {
  const env = loadEnv();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      `INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [env.DEMO_USER_ID, 'Demo User'],
    );
    console.log(rowCount ? `Seeded user ${env.DEMO_USER_ID}` : `User ${env.DEMO_USER_ID} already exists`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
