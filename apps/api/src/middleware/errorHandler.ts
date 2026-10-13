import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiFailure } from '@wallet/shared';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiFailure = { ok: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } };
  res.status(404).json(body);
};

/** Central error handler: consistent JSON, no stack traces or internals leaked. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const body: ApiFailure = {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) logger.warn('Request failed', { path: req.path, code: err.code });
    const body: ApiFailure = { ok: false, error: { code: err.code, message: err.message, details: err.details } };
    res.status(err.status).json(body);
    return;
  }

  // Malformed JSON body from express.json()
  if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } } satisfies ApiFailure);
    return;
  }

  logger.error('Unhandled error', {
    path: req.path,
    error: err instanceof Error ? err.message : 'unknown',
    stack: process.env.NODE_ENV === 'production' ? undefined : err instanceof Error ? err.stack : undefined,
  });
  const body: ApiFailure = { ok: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } };
  res.status(500).json(body);
};
