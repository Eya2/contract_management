import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashRefreshToken } from '../../src/modules/auth/token.service.js';
import { PASSWORD, cookiePair, createUser, refreshCookie } from './helpers.js';

const app = createApp();

async function login(email: string, password = PASSWORD) {
  return request(app).post('/api/auth/login').send({ email, password });
}

function refresh(cookie: string) {
  return request(app).post('/api/auth/refresh').set('Cookie', cookie);
}

/** Pretend a rotation happened long ago, i.e. outside the concurrency grace window. */
async function ageRotation(cookie: string) {
  const token = cookie.split('=')[1]!;
  await prisma.refreshToken.update({
    where: { tokenHash: hashRefreshToken(token) },
    data: { revokedAt: new Date(Date.now() - 60_000) },
  });
}

afterAll(() => prisma.$disconnect());

describe('POST /api/auth/login', () => {
  it('returns an access token and sets a hardened refresh cookie', async () => {
    const user = await createUser('EMPLOYEE');
    const res = await login(user.email);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ id: user.id, role: 'EMPLOYEE' });
    expect(res.body).not.toHaveProperty('refreshToken');

    const cookie = refreshCookie(res)!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it('is case-insensitive on email', async () => {
    const user = await createUser('EMPLOYEE');
    expect((await login(user.email.toUpperCase())).status).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const user = await createUser('EMPLOYEE');
    const wrongPassword = await login(user.email, 'nope');
    const unknownEmail = await login('ghost@test.dev', 'nope');

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('rejects deactivated accounts', async () => {
    const user = await createUser('EMPLOYEE', { isActive: false });
    expect((await login(user.email)).status).toBe(401);
  });

  it('audits both successful and failed attempts', async () => {
    const user = await createUser('LEGAL');
    await login(user.email, 'wrong');
    await login(user.email);

    const actions = await prisma.auditLog.findMany({
      where: { entityId: user.id },
      orderBy: { id: 'asc' },
      select: { action: true, ipAddress: true },
    });
    expect(actions.map((a) => a.action)).toEqual(['AUTH_LOGIN_FAILED', 'AUTH_LOGIN']);
    expect(actions[1]!.ipAddress).toBeTruthy();
  });

  it('validates the payload', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/auth/me', () => {
  it('returns the profile with permissions, never the password hash', async () => {
    const user = await createUser('FINANCE');
    const { body } = await login(user.email);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.permissions).toContain('approval.decide');
    expect(res.body.permissions).not.toContain('contract.create');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('requires a valid bearer token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });
});

describe('refresh-token rotation', () => {
  it('issues a new refresh token and retires the old one', async () => {
    const user = await createUser('MANAGER');
    const first = cookiePair(await login(user.email));
    const res = await refresh(first);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const second = cookiePair(res);
    expect(second).not.toEqual(first);

    const old = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(first.split('=')[1]!) } });
    expect(old?.revokedAt).not.toBeNull();
    expect(old?.replacedById).not.toBeNull();
  });

  it('detects reuse of a rotated token and revokes the whole session', async () => {
    const user = await createUser('MANAGER');
    const stolen = cookiePair(await login(user.email));
    const current = cookiePair(await refresh(stolen)); // legitimate client rotates
    await ageRotation(stolen);

    const replay = await refresh(stolen); // attacker replays the old token
    expect(replay.status).toBe(401);
    expect(refreshCookie(replay)).toMatch(/cms_rt=;/); // cookie cleared

    // The legitimate client's newest token was revoked too: everyone must log in again.
    expect((await refresh(current)).status).toBe(401);

    const alert = await prisma.auditLog.findFirst({ where: { entityId: user.id, action: 'AUTH_TOKEN_REUSE_DETECTED' } });
    expect(alert).not.toBeNull();
  });

  it('treats a replay within the grace window as a benign race, not theft', async () => {
    const user = await createUser('MANAGER');
    const first = cookiePair(await login(user.email));
    const current = cookiePair(await refresh(first));

    expect((await refresh(first)).status).toBe(401); // second tab, same instant
    expect((await refresh(current)).status).toBe(200); // session survives
  });

  it('lets exactly one of two concurrent refreshes win', async () => {
    const user = await createUser('MANAGER');
    const cookie = cookiePair(await login(user.email));
    const results = await Promise.all([refresh(cookie), refresh(cookie), refresh(cookie)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401]);
  });

  it('stops refreshing once the account is deactivated', async () => {
    const user = await createUser('EMPLOYEE');
    const cookie = cookiePair(await login(user.email));
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await refresh(cookie)).status).toBe(401);
  });

  it('rejects a missing or unknown token', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    expect((await refresh('cms_rt=not-a-real-token')).status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const user = await createUser('EMPLOYEE');
    const cookie = cookiePair(await login(user.email));
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);

    expect(res.status).toBe(204);
    expect(refreshCookie(res)).toMatch(/cms_rt=;/);
    expect((await refresh(cookie)).status).toBe(401);
  });
});

describe('RBAC on routes', () => {
  it('forbids non-admins from listing users', async () => {
    for (const role of ['EMPLOYEE', 'MANAGER', 'LEGAL', 'FINANCE'] as const) {
      const user = await createUser(role);
      const { body } = await login(user.email);
      const res = await request(app).get('/api/users').set('Authorization', `Bearer ${body.accessToken}`);
      expect(res.status, role).toBe(403);
    }
  });

  it('lets admins list users without exposing password hashes', async () => {
    const admin = await createUser('ADMIN');
    const { body } = await login(admin.email);
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});
