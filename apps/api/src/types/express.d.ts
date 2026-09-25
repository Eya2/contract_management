import type { AuthUser } from '../common/auth/auth-user.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. */
      user?: AuthUser;
    }
  }
}

export {};
