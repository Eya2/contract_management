import type { DbClient } from '../../lib/prisma.js';
import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** Public shape of a user: never includes the password hash. */
export const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  department: { select: { id: true, name: true, code: true } },
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export const userRepository = {
  /** Includes the password hash — for the login flow only. */
  findByEmailWithSecret(email: string, db: DbClient = prisma) {
    return db.user.findUnique({ where: { email: email.toLowerCase() } });
  },

  findById(id: string, db: DbClient = prisma) {
    return db.user.findUnique({ where: { id }, select: publicUserSelect });
  },

  findMany(where: Prisma.UserWhereInput = {}, db: DbClient = prisma) {
    return db.user.findMany({
      where,
      select: publicUserSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  },

  touchLastLogin(id: string, db: DbClient = prisma) {
    return db.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  },
};
