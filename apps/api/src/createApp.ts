import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import type { HealthDto } from '@wallet/shared';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { walletRoutes, type WalletRouteDeps } from './http/walletRoutes.js';
import { ok } from './http/respond.js';

export interface AppOptions extends WalletRouteDeps {
  /** Authentication middleware. DemoUserMiddleware today; client JWT/session later. */
  authenticate: RequestHandler;
  healthCheck: () => Promise<HealthDto>;
  corsOrigin: string | string[];
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet());
  app.use(cors({ origin: options.corsOrigin, methods: ['GET', 'POST'] }));
  app.use(express.json({ limit: '16kb' }));

  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      logger.info('http', {
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    });
    next();
  });

  // Never cache wallet data in intermediaries/browsers.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    const health = await options.healthCheck();
    res.status(health.status === 'ok' ? 200 : 503);
    ok(res, health, res.statusCode);
  });

  app.use('/api', options.authenticate, walletRoutes(options));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
