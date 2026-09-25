import type { DbClient } from '../../lib/prisma.js';
import { prisma } from '../../lib/prisma.js';

export const refreshTokenRepository = {
  create(
    data: { userId: string; familyId: string; persistent: boolean; tokenHash: string; expiresAt: Date; ipAddress?: string; userAgent?: string },
    db: DbClient = prisma,
  ) {
    return db.refreshToken.create({ data });
  },

  findByHash(tokenHash: string, db: DbClient = prisma) {
    return db.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, role: true, departmentId: true, isActive: true } } },
    });
  },

  /**
   * Compare-and-set: marks the token as rotated only if nobody rotated it first.
   * Returns false when a concurrent request won the race.
   */
  async markRotated(id: string, replacedById: string, db: DbClient = prisma): Promise<boolean> {
    const { count } = await db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById },
    });
    return count === 1;
  },

  /** Revokes every still-valid token of one login session (logout / theft). */
  revokeFamily(familyId: string, db: DbClient = prisma) {
    return db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  revokeAllForUser(userId: string, db: DbClient = prisma) {
    return db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
};
