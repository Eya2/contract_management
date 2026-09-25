import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { AuthUser } from '../auth/auth-user.js';

/**
 * Per-request context (request id, client IP, user agent, authenticated user),
 * available anywhere in the call chain without threading it through every
 * function signature. The audit logger is the main consumer: services just call
 * `audit.record(...)` and the "who / from where" is filled in automatically.
 */
export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  user?: AuthUser;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Runs `fn` inside a context — used by background jobs, the seed script and tests. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  res.setHeader('x-request-id', requestId);
  storage.run(
    { requestId, ip: req.ip, userAgent: req.get('user-agent') ?? undefined },
    () => next(),
  );
};
