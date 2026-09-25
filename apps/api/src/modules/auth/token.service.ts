import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { Role } from '../../generated/prisma/enums.js';

/**
 * Two kinds of tokens, with deliberately different designs:
 *
 * - Access token: a signed JWT, short-lived (15 min), sent in the Authorization
 *   header and kept in memory by the SPA. Verifying it needs no DB round-trip,
 *   which is the point, and also why it must be short-lived: it can't be revoked.
 *
 * - Refresh token: a random opaque string (not a JWT), stored only as a SHA-256
 *   hash, sent in an httpOnly cookie. Being opaque and server-side means it *can*
 *   be revoked, rotated and checked for reuse. A DB leak exposes only hashes.
 */

const ISSUER = 'contract-hub-api';
const AUDIENCE = 'contract-hub-web';

interface AccessTokenClaims {
  sub: string;
  email: string;
  role: Role;
  dept: string;
}

export function signAccessToken(user: AuthUser): string {
  const claims: AccessTokenClaims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    dept: user.departmentId,
  };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/**
 * Returns the principal, or null for any invalid token (bad signature, expired,
 * wrong issuer/audience, unexpected algorithm). The algorithm is pinned so a
 * token claiming `alg: none` or an asymmetric algorithm is always rejected.
 */
export function verifyAccessToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === 'string' || !isAccessClaims(payload)) return null;
    return { id: payload.sub, email: payload.email, role: payload.role, departmentId: payload.dept };
  } catch {
    return null;
  }
}

function isAccessClaims(p: jwt.JwtPayload): p is jwt.JwtPayload & AccessTokenClaims {
  return (
    typeof p.sub === 'string' &&
    typeof p.email === 'string' &&
    typeof p.dept === 'string' &&
    Object.values(Role).includes(p.role)
  );
}

/** 256 bits of randomness, URL-safe. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 (not argon2) is right here: the input is already 256 random bits, so
 * brute force is infeasible and a fast, deterministic hash allows an indexed lookup.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(from = new Date()): Date {
  return new Date(from.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
