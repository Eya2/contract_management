import { getRequestContext } from '../../common/context/request-context.js';
import type { DbClient } from '../../lib/prisma.js';
import { prisma } from '../../lib/prisma.js';
import type { AuditAction, Prisma } from '../../generated/prisma/client.js';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  contractId?: string;
  metadata?: Prisma.InputJsonValue;
  /** Override the actor (e.g. a successful login, before req.user exists). */
  userId?: string | null;
}

/**
 * Writes one audit row. Actor, IP and user agent come from the request context.
 *
 * Pass the transaction client (`tx`) when auditing a state change, so the audit
 * row commits or rolls back *together* with the change it describes: no audit
 * entries for things that didn't happen, and no changes without an entry.
 */
export async function recordAudit(entry: AuditEntry, db: DbClient = prisma): Promise<void> {
  const ctx = getRequestContext();
  await db.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      contractId: entry.contractId,
      metadata: entry.metadata,
      userId: entry.userId !== undefined ? entry.userId : (ctx?.user?.id ?? null),
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
    },
  });
}
