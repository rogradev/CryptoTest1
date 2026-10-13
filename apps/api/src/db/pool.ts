import pg from 'pg';

export type Database = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  // BIGINT (int8) stays a string by default in node-postgres; we convert to
  // bigint explicitly in repositories, never to a JS number.
  return pool;
}
