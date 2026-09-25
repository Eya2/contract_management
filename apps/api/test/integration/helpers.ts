import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import type { Role } from '../../src/generated/prisma/enums.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashPassword } from '../../src/modules/auth/password.js';

export const PASSWORD = 'Correct-Horse-9';

let passwordHash: Promise<string> | undefined;

/** Creates a department + user with unique names, so test files never collide. */
export async function createUser(role: Role, overrides: { isActive?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const department = await prisma.department.create({
    data: { name: `Dept ${suffix}`, code: suffix.toUpperCase() },
  });
  passwordHash ??= hashPassword(PASSWORD);
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${suffix}@test.dev`,
      passwordHash: await passwordHash,
      firstName: 'Test',
      lastName: role,
      role,
      departmentId: department.id,
      isActive: overrides.isActive ?? true,
    },
  });
}

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
