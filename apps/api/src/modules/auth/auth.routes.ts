import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { authenticate } from '../../common/middleware/authenticate.js';
import { z } from 'zod';
import { currentUser } from '../../common/middleware/authenticate.js';
import { accountService } from './account.service.js';
import { authController } from './auth.controller.js';
import { readRefreshCookie } from './auth.cookies.js';
import { authService } from './auth.service.js';

export const authRouter = Router();

/** Slows down credential stuffing: 10 login attempts per IP per 15 minutes. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts, try again later' } },
});

authRouter.post('/login', loginLimiter, authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', authenticate, authController.me);

/** 10+ characters with a letter and a digit (same rule as admin-created accounts). */
const NewPassword = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/\d/, 'Include a digit');
const ResetToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid reset link');

// Same limiter as login: stops using the form to flood someone's inbox.
authRouter.post('/forgot-password', loginLimiter, async (req, res) => {
  const { email } = z.object({ email: z.email().max(254) }).parse(req.body);
  await accountService.requestPasswordReset(email);
  res.status(202).json({ message: 'If an account exists for this email, a reset link is on its way.' });
});

authRouter.get('/reset-password/:token', async (req, res) => {
  res.json(await accountService.checkResetToken(ResetToken.parse(req.params.token)));
});

authRouter.post('/reset-password', loginLimiter, async (req, res) => {
  const { token, password } = z.object({ token: ResetToken, password: NewPassword }).parse(req.body);
  await accountService.resetPassword(token, password);
  res.status(204).end();
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1).max(200), newPassword: NewPassword }).parse(req.body);
  await accountService.changePassword(currentUser(req), currentPassword, newPassword, readRefreshCookie(req));
  res.status(204).end();
});

authRouter.patch('/me', authenticate, async (req, res) => {
  const body = z.object({ firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100) }).partial().parse(req.body);
  await accountService.updateProfile(currentUser(req), body);
  res.json(await authService.me(currentUser(req).id));
});
