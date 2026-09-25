import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { getRequestContext } from '../../common/context/request-context.js';
import { BadRequestError } from '../../common/errors/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { sha256Hex } from '../../lib/storage.js';
import { recordAudit } from '../audit/audit.service.js';
import { userRepository } from '../users/user.repository.js';
import { hashPassword, verifyPassword } from './password.js';
import { refreshTokenRepository } from './refresh-token.repository.js';
import { hashRefreshToken } from './token.service.js';

const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Self-service account operations: forgotten password, password change,
 * profile. Follows the OWASP Forgot Password cheat sheet:
 *  - the request always answers the same, whether or not the email exists;
 *  - the link carries a 256-bit random token, stored only as a hash;
 *  - it's single-use, expires after an hour, and a newer link replaces it;
 *  - a successful reset signs the user out everywhere.
 */
export const accountService = {
  async requestPasswordReset(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) {
      // Same outcome and similar work either way, so nothing is revealed.
      await recordAudit({ action: 'AUTH_PASSWORD_RESET_REQUESTED', entityType: 'user', userId: null, metadata: { email, known: false } });
      return;
    }
    const token = randomBytes(32).toString('base64url');
    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
          ipAddress: getRequestContext()?.ip,
        },
      });
      await tx.job.create({
        data: {
          type: 'email.send',
          payload: {
            to: user.email,
            subject: 'Reset your Contract Hub password',
            text:
              `Hello ${user.firstName},\n\nSomeone (hopefully you) asked to reset your Contract Hub password. ` +
              `The link below is valid for one hour and can be used once.\n\n` +
              `If you didn't ask for this, ignore this email: your password stays the same.`,
            link: `/reset-password?token=${token}`,
          },
        },
      });
      await recordAudit({ action: 'AUTH_PASSWORD_RESET_REQUESTED', entityType: 'user', entityId: user.id, userId: user.id }, tx);
    });
  },

  /** Checks a reset link without using it, so the page can say "expired" before the user types. */
  async checkResetToken(token: string): Promise<{ valid: boolean }> {
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    return { valid: !!row && !row.usedAt && row.expiresAt > new Date() };
  },

  async resetPassword(token: string, password: string): Promise<void> {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Compare-and-set: two submissions of the same link can't both succeed.
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
      const { count } = await tx.passwordResetToken.updateMany({
        where: { tokenHash: sha256Hex(token), usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (!row || count !== 1) throw new BadRequestError('This reset link is invalid or has expired. Request a new one.');
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password) } });
      await refreshTokenRepository.revokeAllForUser(row.userId, tx);
      await recordAudit({ action: 'AUTH_PASSWORD_RESET', entityType: 'user', entityId: row.userId, userId: row.userId }, tx);
    });
  },

  /**
   * Changes the password of the signed-in user. Other sessions are signed out;
   * the current one (identified by its refresh cookie) stays signed in.
   */
  async changePassword(user: AuthUser, currentPassword: string, newPassword: string, refreshCookie: string | undefined) {
    const record = await userRepository.findByEmailWithSecret(user.email);
    if (!record || !(await verifyPassword(record.passwordHash, currentPassword))) {
      // 400, not 401: a 401 would make the web app treat this as an expired session.
      throw new BadRequestError('Your current password is not correct');
    }
    if (currentPassword === newPassword) throw new BadRequestError('Choose a password different from the current one');
    const current = refreshCookie ? await refreshTokenRepository.findByHash(hashRefreshToken(refreshCookie)) : null;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null, ...(current ? { NOT: { familyId: current.familyId } } : {}) },
        data: { revokedAt: new Date() },
      });
      await recordAudit({ action: 'AUTH_PASSWORD_CHANGED', entityType: 'user', entityId: user.id }, tx);
    });
  },

  async updateProfile(user: AuthUser, data: { firstName?: string; lastName?: string }) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data });
      await recordAudit({ action: 'USER_UPDATED', entityType: 'user', entityId: user.id, metadata: { profile: data } }, tx);
    });
  },
};
