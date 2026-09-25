import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../../modules/auth/token.service.js';
import { getRequestContext } from '../context/request-context.js';
import { ForbiddenError, UnauthorizedError } from '../errors/app-error.js';
import type { AuthUser } from '../auth/auth-user.js';
import { hasPermission, type Permission } from '../auth/permissions.js';

/**
 * Requires a valid `Authorization: Bearer <access token>` header.
 *
 * The token is trusted without a DB lookup (that's what makes JWTs cheap).
 * Trade-off: a deactivated user or a role change takes effect at the next
 * refresh, within 15 minutes at most. Refresh *does* re-read the user row.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const user = token ? verifyAccessToken(token) : null;
  if (!user) {
    next(new UnauthorizedError());
    return;
  }
  req.user = user;
  const ctx = getRequestContext();
  if (ctx) ctx.user = user;
  next();
};

/**
 * Route-level RBAC. Use after `authenticate`:
 *   router.post('/', authenticate, requirePermission(Permission.CONTRACT_CREATE), handler)
 * With several permissions, the user needs *all* of them.
 */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) {
      next(new UnauthorizedError());
      return;
    }
    const missing = permissions.filter((p) => !hasPermission(user.role, p));
    next(missing.length ? new ForbiddenError() : undefined);
  };
}

/** Narrowing helper for controllers behind `authenticate`. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}
