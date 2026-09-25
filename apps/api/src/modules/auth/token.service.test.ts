import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './token.service.js';

const principal = { id: 'u1', email: 'a@b.dev', role: 'LEGAL' as const, departmentId: 'd1' };

describe('access tokens', () => {
  it('round-trips the principal', () => {
    expect(verifyAccessToken(signAccessToken(principal))).toEqual(principal);
  });

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({ sub: 'u1', email: 'a@b.dev', role: 'ADMIN', dept: 'd1' }, 'x'.repeat(40), {
      issuer: 'contract-hub-api',
      audience: 'contract-hub-web',
    });
    expect(verifyAccessToken(forged)).toBeNull();
  });

  it('rejects an unsigned "alg: none" token', () => {
    const unsigned = jwt.sign({ sub: 'u1', email: 'a@b.dev', role: 'ADMIN', dept: 'd1' }, '', {
      algorithm: 'none',
    });
    expect(verifyAccessToken(unsigned)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = signAccessToken(principal).split('.');
    const payload = Buffer.from(JSON.stringify({ ...principal, role: 'ADMIN' })).toString('base64url');
    expect(verifyAccessToken(`${header}.${payload}.${signature}`)).toBeNull();
  });

  it('rejects an unknown role claim', () => {
    const token = jwt.sign({ sub: 'u1', email: 'a@b.dev', role: 'ROOT', dept: 'd1' }, process.env.JWT_ACCESS_SECRET!, {
      issuer: 'contract-hub-api',
      audience: 'contract-hub-web',
    });
    expect(verifyAccessToken(token)).toBeNull();
  });
});

describe('refresh tokens', () => {
  it('are random and hashed deterministically', () => {
    const a = generateRefreshToken();
    expect(a).not.toEqual(generateRefreshToken());
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashRefreshToken(a)).toEqual(hashRefreshToken(a));
    expect(hashRefreshToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
