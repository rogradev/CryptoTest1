import type { Request } from 'express';
import { Errors } from '../lib/errors.js';

/**
 * The only identity contract the wallet module relies on.
 * Any middleware that sets `req.user = { id, authMode }` can be plugged in.
 */
export interface AuthenticatedUser {
  id: string;
  authMode: 'demo' | 'external';
}

/** Reads the authenticated user id or fails with 401. Controllers use only this. */
export function requireUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw Errors.unauthorized();
  return id;
}
