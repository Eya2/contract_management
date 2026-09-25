import type { CookieOptions, Request, Response } from 'express';
import { isProduction } from '../../config/env.js';

export const REFRESH_COOKIE = 'cms_rt';

/**
 * - httpOnly: JavaScript (and so any XSS payload) can't read the token.
 * - sameSite=strict + path=/api/auth: the browser only sends it to the auth
 *   endpoints, and never on cross-site requests. That is what makes the
 *   cookie-based refresh endpoint safe from CSRF. All other endpoints use the
 *   Authorization header, which browsers never attach automatically.
 * - secure in production: HTTPS only.
 */
const baseOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  path: '/api/auth',
};

export function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions, expires });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions);
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}
