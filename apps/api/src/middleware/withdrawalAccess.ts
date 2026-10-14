import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { Errors } from '../lib/errors.js';
import type { WithdrawalPolicy } from '../services/withdrawalService.js';

export const ACCESS_CODE_HEADER = 'x-withdrawal-access-code';

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60_000;

/**
 * DEMO SAFETY GATE for executing real withdrawals (not authentication).
 *
 * - WITHDRAWALS_ENABLED=false → every execution is refused (403).
 * - WITHDRAWAL_ACCESS_CODE set → the X-Withdrawal-Access-Code header must
 *   match (constant-time comparison); 5 failures per client per 15 minutes
 *   lock that client out (429). Counters are per instance — enough to stop
 *   casual guessing on a demo, not a substitute for real auth.
 *
 * When the client's authentication is integrated, replace this gate with
 * their authorization rules; the withdrawal service does not depend on it.
 */
export function withdrawalAccessGate(policy: WithdrawalPolicy, now: () => number = Date.now): RequestHandler {
  const failures = new Map<string, { count: number; resetAt: number }>();
  const expected = policy.accessCode ? digest(policy.accessCode) : null;

  return (req, _res, next) => {
    if (!policy.enabled) throw Errors.withdrawalsDisabled();
    if (!expected) return next();

    const client = clientKey(req);
    const entry = failures.get(client);
    if (entry && entry.resetAt <= now()) failures.delete(client);
    if ((failures.get(client)?.count ?? 0) >= MAX_FAILED_ATTEMPTS) throw Errors.tooManyAttempts();

    const provided = req.get(ACCESS_CODE_HEADER) ?? '';
    if (!timingSafeEqual(digest(provided), expected)) {
      const current = failures.get(client) ?? { count: 0, resetAt: now() + ATTEMPT_WINDOW_MS };
      current.count++;
      failures.set(client, current);
      throw Errors.withdrawalAccessDenied();
    }
    failures.delete(client);
    next();
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function clientKey(req: Request): string {
  // Vercel sets x-real-ip to the client address; fall back to the socket address.
  return req.get('x-real-ip') ?? req.ip ?? 'unknown';
}
