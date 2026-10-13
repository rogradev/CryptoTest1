import express, { type Express } from 'express';
import type { ApiFailure } from '@wallet/shared';
import { EnvValidationError, loadEnv } from './config/env.js';
import { createContainer, createHttpApp } from './container.js';
import { createPool } from './db/pool.js';
import { logger } from './lib/logger.js';

/**
 * Vercel Function entrypoint for the `api` service (vercel.json).
 *
 * Vercel's Express builder auto-detects `src/app.ts` and invokes its default
 * export per request — no app.listen(). Public `/api/*` requests arrive with
 * their original path, so the routes mounted under `/api` match unchanged.
 * The long-running local server lives in src/server.ts.
 */
function createApiApp(): Express {
  try {
    const env = loadEnv();
    return createHttpApp(env, createContainer(env, createPool(env.DATABASE_URL)));
  } catch (error) {
    return createStartupErrorApp(error);
  }
}

/**
 * Serverless functions have no startup console to read, so a configuration
 * error would otherwise surface only as an opaque platform 500. Answer every
 * request with a JSON error naming the invalid variables (never their values).
 */
function createStartupErrorApp(error: unknown): Express {
  const details = error instanceof EnvValidationError ? error.issues : undefined;
  logger.error('API failed to start', {
    error: error instanceof Error ? error.message : String(error),
  });
  const body: ApiFailure = {
    ok: false,
    error: details
      ? { code: 'CONFIG_ERROR', message: 'API is not configured. Set the missing environment variables.', details }
      : { code: 'STARTUP_ERROR', message: 'API failed to start. Check the function logs.' },
  };
  const app = express();
  app.use((_req, res) => {
    res.status(503).json(body);
  });
  return app;
}

const app: Express = createApiApp();
export default app;
