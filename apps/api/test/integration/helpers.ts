import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import type { createApp } from '../../src/app.js';
import type { Role } from '../../src/generated/prisma/enums.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/modules/auth/password.js';

export const PASSWORD = 'Correct-Horse-9';

type App = ReturnType<typeof createApp>;

let passwordHash: Promise<string> | undefined;

/** Creates a department with a unique name and code. */
export async function createDepartment() {
  const suffix = randomUUID().slice(0, 8);
  return prisma.department.create({ data: { name: `Dept ${suffix}`, code: suffix.toUpperCase() } });
}

/**
 * Creates a user with a unique email, in a fresh department unless one is
 * given, so test files never collide.
 */
export async function createUser(role: Role, overrides: { isActive?: boolean; departmentId?: string } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const departmentId = overrides.departmentId ?? (await createDepartment()).id;
  passwordHash ??= hashPassword(PASSWORD);
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}@test.dev`,
      passwordHash: await passwordHash,
      firstName: 'Test',
      lastName: role,
      role,
      departmentId,
      isActive: overrides.isActive ?? true,
    },
  });
}

export async function createCounterparty() {
  return prisma.counterparty.create({ data: { name: `Counterparty ${randomUUID().slice(0, 8)}` } });
}

/**
 * A logged-in API client for one user: `as(user).post(path).send(...)` with
 * the bearer token already set.
 */
export async function clientFor(app: App, user: { email: string }) {
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed for ${user.email}: ${res.status}`);
  const auth = `Bearer ${res.body.accessToken as string}`;
  return {
    get: (path: string) => request(app).get(path).set('Authorization', auth),
    post: (path: string) => request(app).post(path).set('Authorization', auth),
    patch: (path: string) => request(app).patch(path).set('Authorization', auth),
    put: (path: string) => request(app).put(path).set('Authorization', auth),
    delete: (path: string) => request(app).delete(path).set('Authorization', auth),
  };
}
export type Client = Awaited<ReturnType<typeof clientFor>>;

/** Extracts the refresh-token cookie ("cms_rt=…; Path=…") from a response. */
export function refreshCookie(res: Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('cms_rt='));
}

/** Just the "cms_rt=value" pair, ready to send back in a Cookie header. */
export function cookiePair(res: Response): string {
  const cookie = refreshCookie(res);
  if (!cookie) throw new Error('No refresh cookie in response');
  return cookie.split(';')[0]!;
}
