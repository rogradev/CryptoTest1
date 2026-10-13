import type { AuthenticatedUser } from '../middleware/auth.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the authentication middleware (DemoUserMiddleware in this checkpoint). */
      user?: AuthenticatedUser;
    }
  }
}

export {};
