import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { permissionsFor } from '../../common/auth/permissions.js';
import { getRequestContext } from '../../common/context/request-context.js';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { logger } from '../../lib/logger.js';
import { prisma, type DbClient } from '../../lib/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { userRepository } from '../users/user.repository.js';
import { verifyAgainstDummy, verifyPassword } from './password.js';
import { refreshTokenRepository } from './refresh-token.repository.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from './token.service.js';

export interface AuthResult {
  accessToken: string;
  /** Raw refresh token: goes into the httpOnly cookie, never into a response body. */
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: AuthUser;
}

/**
 * Window in which a just-rotated token is treated as a benign race (two browser
 * tabs refreshing at the same moment) instead of theft.
 */
const ROTATION_GRACE_MS = 10_000;

/** One message for every login failure, so responses don't reveal which emails exist. */
const INVALID_CREDENTIALS = 'Invalid email or password';

export const authService = {
  async login(email: string, password: string): Promise<AuthResult> {
    const user = await userRepository.findByEmailWithSecret(email);

    const valid = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstDummy(password);

    if (!user || !valid || !user.isActive) {
      await recordAudit({
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'user',
        entityId: user?.id,
        userId: user?.id ?? null,
        metadata: { email: email.toLowerCase(), reason: !user ? 'unknown_email' : !valid ? 'bad_password' : 'inactive' },
      });
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    const principal = toPrincipal(user);
    return prisma.$transaction(async (tx) => {
      const { refreshTokenId: _, ...issued } = await issueTokens(principal, randomUUID(), tx);
      await userRepository.touchLastLogin(user.id, tx);
      await recordAudit({ action: 'AUTH_LOGIN', entityType: 'user', entityId: user.id, userId: user.id }, tx);
      return issued;
    });
  },

  /**
   * Refresh-token rotation with reuse detection (OAuth 2.0 Security BCP §4.14):
   * every refresh returns a new refresh token and retires the presented one.
   * If an already-retired token shows up again, someone replayed it (the
   * legitimate client always holds the newest one), so the whole session family
   * is revoked. That forces the thief *and* the victim to log in again, and the
   * attacker's window ends at once.
   */
  async refresh(rawToken: string | undefined): Promise<AuthResult> {
    if (!rawToken) throw new UnauthorizedError('No refresh token');

    const stored = await refreshTokenRepository.findByHash(hashRefreshToken(rawToken));
    if (!stored) throw new UnauthorizedError('Invalid refresh token');

    if (stored.revokedAt) {
      const wasRotated = stored.replacedById !== null;
      const withinGrace = Date.now() - stored.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (wasRotated && !withinGrace) {
        await refreshTokenRepository.revokeFamily(stored.familyId);
        await recordAudit({
          action: 'AUTH_TOKEN_REUSE_DETECTED',
          entityType: 'user',
          entityId: stored.userId,
          userId: stored.userId,
          metadata: { familyId: stored.familyId },
        });
        logger.warn({ userId: stored.userId, familyId: stored.familyId }, 'Refresh token reuse detected');
      }
      throw new UnauthorizedError('Refresh token is no longer valid');
    }

    if (stored.expiresAt <= new Date()) throw new UnauthorizedError('Refresh token expired');

    // Unlike the access token, refresh re-reads the user row: deactivation and
    // role changes take effect here.
    if (!stored.user.isActive) {
      await refreshTokenRepository.revokeFamily(stored.familyId);
      throw new UnauthorizedError('Account is disabled');
    }

    const principal = toPrincipal(stored.user);
    return prisma.$transaction(async (tx) => {
      const { refreshTokenId, ...issued } = await issueTokens(principal, stored.familyId, tx);
      const won = await refreshTokenRepository.markRotated(stored.id, refreshTokenId, tx);
      // A concurrent refresh rotated this token first; throwing rolls back our new token.
      if (!won) throw new UnauthorizedError('Refresh token is no longer valid');
      return issued;
    });
  },

  /** Ends the session: revokes the whole family of the presented refresh token. */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const stored = await refreshTokenRepository.findByHash(hashRefreshToken(rawToken));
    if (!stored) return;
    await refreshTokenRepository.revokeFamily(stored.familyId);
    await recordAudit({ action: 'AUTH_LOGOUT', entityType: 'user', entityId: stored.userId, userId: stored.userId });
  },

  async me(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user || !user.isActive) throw new UnauthorizedError();
    return { ...user, permissions: permissionsFor(user.role) };
  },
};

function toPrincipal(user: { id: string; email: string; role: AuthUser['role']; departmentId: string }): AuthUser {
  return { id: user.id, email: user.email, role: user.role, departmentId: user.departmentId };
}

/** Creates a refresh token (in `familyId`) plus a matching access token. */
async function issueTokens(
  user: AuthUser,
  familyId: string,
  tx: DbClient,
): Promise<AuthResult & { refreshTokenId: string }> {
  const ctx = getRequestContext();
  const refreshToken = generateRefreshToken();
  const refreshTokenExpiresAt = refreshTokenExpiry();
  const record = await refreshTokenRepository.create(
    {
      userId: user.id,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiresAt,
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
    },
    tx,
  );
  return {
    accessToken: signAccessToken(user),
    refreshToken,
    refreshTokenExpiresAt,
    refreshTokenId: record.id,
    user,
  };
}
