import type { Request, Response } from 'express';
import { currentUser } from '../../common/middleware/authenticate.js';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth.cookies.js';
import { LoginBody } from './auth.schemas.js';
import { authService, type AuthResult } from './auth.service.js';

/** The refresh token travels only in the cookie; the body carries the access token. */
function sendSession(res: Response, result: AuthResult) {
  // A persistent session gets a dated cookie; otherwise a session cookie that ends with the browser.
  setRefreshCookie(res, result.refreshToken, result.persistent ? result.refreshTokenExpiresAt : undefined);
  res.json({ accessToken: result.accessToken, user: result.user });
}

export const authController = {
  async login(req: Request, res: Response) {
    const { email, password, remember } = LoginBody.parse(req.body);
    sendSession(res, await authService.login(email, password, remember));
  },

  async refresh(req: Request, res: Response) {
    try {
      sendSession(res, await authService.refresh(readRefreshCookie(req)));
    } catch (err) {
      // A dead refresh token means the session is over: drop the cookie too.
      if (err instanceof UnauthorizedError) clearRefreshCookie(res);
      throw err;
    }
  },

  async logout(req: Request, res: Response) {
    await authService.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
    res.status(204).end();
  },

  async me(req: Request, res: Response) {
    res.json(await authService.me(currentUser(req).id));
  },
};
