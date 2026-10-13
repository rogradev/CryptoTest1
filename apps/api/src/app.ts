import type { Express } from 'express';
import { loadEnv } from './config/env.js';
import { createContainer, createHttpApp } from './container.js';
import { createPool } from './db/pool.js';

/**
 * Vercel Function entrypoint for the `api` service (vercel.json).
 *
 * Vercel's Express builder auto-detects `src/app.ts` and invokes its default
 * export per request — no app.listen(). Public `/api/*` requests arrive with
 * their original path, so the routes mounted under `/api` match unchanged.
 * The long-running local server lives in src/server.ts.
 */
const env = loadEnv();
const pool = createPool(env.DATABASE_URL);

const app: Express = createHttpApp(env, createContainer(env, pool));
export default app;
