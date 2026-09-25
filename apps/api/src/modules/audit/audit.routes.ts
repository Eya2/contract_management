import { Router } from 'express';
import { z } from 'zod';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, currentUser, requirePermission } from '../../common/middleware/authenticate.js';
import { AuditAction } from '../../generated/prisma/enums.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { findVisibleOrThrow } from '../contracts/contract.service.js';

/**
 * Read access to the append-only audit log (Admin and Legal hold audit.read).
 * Entries are paged with a cursor on the BigInt id, which is also the strict
 * insertion order.
 */
export const auditRouter = Router();
auditRouter.use(authenticate, requirePermission(Permission.AUDIT_READ));

const ListQuery = z.object({
  action: z.enum(AuditAction).optional(),
  userId: z.uuid().optional(),
  contractId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Cursor: entries older than this id. */
  before: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const select = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  contractId: true,
  ipAddress: true,
  userAgent: true,
  metadata: true,
  createdAt: true,
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
  contract: { select: { referenceNumber: true, title: true } },
} satisfies Prisma.AuditLogSelect;

type Row = Prisma.AuditLogGetPayload<{ select: typeof select }>;

/** BigInt doesn't survive JSON.stringify, so ids go out as strings. */
function present(rows: Row[], limit: number) {
  return {
    items: rows.map((r) => ({ ...r, id: r.id.toString() })),
    nextCursor: rows.length === limit ? rows[rows.length - 1]!.id.toString() : null,
  };
}

auditRouter.get('/', async (req, res) => {
  const q = ListQuery.parse(req.query);
  const rows = await prisma.auditLog.findMany({
    where: {
      action: q.action,
      userId: q.userId,
      contractId: q.contractId,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
      id: q.before ? { lt: BigInt(q.before) } : undefined,
    },
    select,
    orderBy: { id: 'desc' },
    take: q.limit,
  });
  res.json(present(rows, q.limit));
});

/** The audit trail of one contract, for the contract's "Activity" tab. */
export const contractAuditRouter = Router();
contractAuditRouter.get('/:id/audit', authenticate, requirePermission(Permission.AUDIT_READ), async (req, res) => {
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  const { before, limit } = ListQuery.pick({ before: true, limit: true }).parse(req.query);
  await findVisibleOrThrow(currentUser(req), id);
  const rows = await prisma.auditLog.findMany({
    where: { contractId: id, id: before ? { lt: BigInt(before) } : undefined },
    select,
    orderBy: { id: 'desc' },
    take: limit,
  });
  res.json(present(rows, limit));
});
