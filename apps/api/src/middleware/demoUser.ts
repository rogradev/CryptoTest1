import type { RequestHandler } from 'express';

/**
 * DemoUserMiddleware — TEMPORARY DEVELOPMENT IDENTITY.
 *
 * Attaches a fixed demo user to every request. When integrating with the
 * client's backend, replace this single middleware (see createApp's
 * `authenticate` option) with their JWT/session middleware that sets
 * `req.user = { id, authMode: 'external' }`. Nothing else changes.
 */
export function demoUserMiddleware(demoUserId: string): RequestHandler {
  return (req, _res, next) => {
    req.user = { id: demoUserId, authMode: 'demo' };
    next();
  };
}
