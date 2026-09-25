import type { AuthUser } from '../../common/auth/auth-user.js';
import { ConflictError, ForbiddenError } from '../../common/errors/app-error.js';
import type { Contract, ContractStatus } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';
import { prisma, type DbClient } from '../../lib/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { computeContentHash, type ContractContent } from '../contracts/contract-content.js';
import { transitionContract } from '../contracts/contract-status.js';
import { contentOf, findVisibleOrThrow, headFields, loadDetail, writeVersion } from '../contracts/contract.service.js';
import { contractLink, notify } from '../notifications/notification.service.js';
import { nextTerm, reminderThreshold, startOfUtcDay, daysBetween } from './renewal-dates.js';

/**
 * Renewals and the end of a contract's term.
 *
 *  - Reminders: owner and department head are notified 30, 7 and 1 days before
 *    the end date, each exactly once (notification + email dedupe keys).
 *  - End of term (the day after `endDate`):
 *      renewal already signed/active  → RENEWED
 *      auto-renew on, no renewal       → a new term starts on the same terms, old → RENEWED
 *      otherwise                       → EXPIRED
 *  - Manual renewal: a DRAFT copy with the next term's dates, linked by
 *    `renewalOfId`, that goes through approval and signature like any contract.
 *
 * An auto-renewal needs no new approval or signature: the parties already
 * agreed to it in the signed contract. It is recorded in the timeline and audit
 * log, and the successor keeps the same clauses and document.
 */

/** Statuses in which a renewal is actually in force (or about to be). */
const RENEWAL_IN_FORCE: ContractStatus[] = ['SIGNED', 'ACTIVE'];

export const renewalService = {
  /** One pass of the scheduler: reminders, then ends of term. Idempotent. */
  async runOnce(now = new Date()): Promise<{ reminded: number; expired: number; renewed: number; autoRenewed: number }> {
    const today = startOfUtcDay(now);
    const result = { reminded: 0, expired: 0, renewed: 0, autoRenewed: 0 };

    const endingSoon = await prisma.contract.findMany({
      where: { status: 'ACTIVE', endDate: { gte: today, lte: new Date(today.getTime() + 30 * 86_400_000) } },
      include: { department: { select: { headId: true } }, renewedBy: { select: { status: true } } },
    });
    for (const c of endingSoon) {
      if (c.renewedBy && RENEWAL_IN_FORCE.includes(c.renewedBy.status)) continue; // already taken care of
      const daysLeft = daysBetween(today, c.endDate!);
      const threshold = reminderThreshold(daysLeft);
      if (threshold === null) continue;
      try {
        const created = await prisma.$transaction(async (tx) => {
          const before = await tx.notification.count({ where: { dedupeKey: { startsWith: `expiry:${c.id}:${threshold}d:` } } });
          if (before > 0) return false;
          await notify(tx, [c.ownerId, ...(c.department.headId ? [c.department.headId] : [])], {
            type: 'CONTRACT_EXPIRING',
            title: `${c.referenceNumber} ${c.title} ${daysLeft === 0 ? 'ends today' : daysLeft === 1 ? 'ends tomorrow' : `ends in ${daysLeft} days`}`,
            body: c.autoRenew
              ? `It renews automatically on ${nextTerm(c).startDate.toISOString().slice(0, 10)} unless you act before then.`
              : c.renewedBy
                ? 'A renewal is in progress but not signed yet.'
                : 'It does not renew automatically. Start a renewal if it should continue.',
            contractId: c.id,
            link: contractLink(c.id),
            dedupeKey: `expiry:${c.id}:${threshold}d`,
          });
          return true;
        });
        if (created) result.reminded++;
      } catch (err) {
        logger.error({ err, contractId: c.id }, 'Expiry reminder failed');
      }
    }

    const ended = await prisma.contract.findMany({
      where: { status: 'ACTIVE', endDate: { lt: today } },
      select: { id: true },
      take: 200,
    });
    for (const { id } of ended) {
      try {
        const outcome = await endTerm(id, now);
        if (outcome) result[outcome]++;
      } catch (err) {
        logger.error({ err, contractId: id }, 'End of term failed');
      }
    }
    return result;
  },

  /** Starts a renewal by hand: a DRAFT for the next term, which then goes through approval. */
  async renew(user: AuthUser, contractId: string) {
    const visible = await findVisibleOrThrow(user, contractId);
    if (user.role !== 'ADMIN' && visible.ownerId !== user.id) {
      throw new ForbiddenError('Only the contract owner or an admin can renew it');
    }
    const id = await prisma.$transaction(async (tx) => {
      const source = await lockContract(tx, contractId);
      if (!['ACTIVE', 'EXPIRED', 'SIGNED'].includes(source.status)) {
        throw new ConflictError(`A ${source.status} contract can't be renewed`);
      }
      if (await tx.contract.findUnique({ where: { renewalOfId: contractId }, select: { id: true } })) {
        throw new ConflictError('A renewal of this contract already exists');
      }
      return createSuccessor(tx, source, { status: 'DRAFT', actorId: user.id });
    });
    return loadDetail(id);
  },
};

/** Moves an ACTIVE contract whose end date has passed to RENEWED or EXPIRED. */
async function endTerm(id: string, now: Date): Promise<'expired' | 'renewed' | 'autoRenewed' | null> {
  return prisma.$transaction(async (tx) => {
    const c = await lockContract(tx, id);
    if (c.status !== 'ACTIVE' || !c.endDate || c.endDate >= startOfUtcDay(now)) return null; // handled meanwhile
    const renewal = await tx.contract.findUnique({ where: { renewalOfId: id } });

    if (renewal && RENEWAL_IN_FORCE.includes(renewal.status)) {
      await transitionContract(tx, { contractId: id, from: 'ACTIVE', to: 'RENEWED', actorId: null, reason: `Continued by ${renewal.referenceNumber}` });
      await recordAudit({ action: 'CONTRACT_RENEWED', entityType: 'contract', entityId: id, contractId: id, userId: null, metadata: { renewal: renewal.referenceNumber } }, tx);
      return 'renewed';
    }

    if (c.autoRenew && !renewal) {
      const successorId = await createSuccessor(tx, c, { status: 'ACTIVE', actorId: null, now });
      const successor = await tx.contract.findUniqueOrThrow({ where: { id: successorId } });
      await transitionContract(tx, { contractId: id, from: 'ACTIVE', to: 'RENEWED', actorId: null, reason: `Renewed automatically as ${successor.referenceNumber}` });
      await recordAudit(
        { action: 'CONTRACT_RENEWED', entityType: 'contract', entityId: id, contractId: id, userId: null, metadata: { renewal: successor.referenceNumber, automatic: true } },
        tx,
      );
      await notify(tx, [c.ownerId], {
        type: 'CONTRACT_EXPIRING',
        title: `${c.referenceNumber} ${c.title} renewed automatically`,
        body: `A new term runs from ${successor.startDate?.toISOString().slice(0, 10)} to ${successor.endDate?.toISOString().slice(0, 10)} as ${successor.referenceNumber}, on the same terms.`,
        contractId: successorId,
        link: contractLink(successorId),
        dedupeKey: `auto-renewed:${id}`,
      });
      return 'autoRenewed';
    }

    // A renewal still in draft/review doesn't keep the old contract alive; when
    // it's signed later, signing marks this one RENEWED (EXPIRED → RENEWED).
    await transitionContract(tx, { contractId: id, from: 'ACTIVE', to: 'EXPIRED', actorId: null, reason: 'End date reached' });
    await recordAudit({ action: 'CONTRACT_EXPIRED', entityType: 'contract', entityId: id, contractId: id, userId: null }, tx);
    await notify(tx, [c.ownerId], {
      type: 'CONTRACT_EXPIRING',
      title: `${c.referenceNumber} ${c.title} has expired`,
      body: renewal ? `Its renewal ${renewal.referenceNumber} is not signed yet.` : 'It ended without renewal. You can still start one.',
      contractId: id,
      link: contractLink(id),
      dedupeKey: `expired:${id}`,
    });
    return 'expired';
  });
}

/**
 * Creates the next term of `source`: same content, dates moved forward, linked
 * by renewalOfId. `status` DRAFT for a manual renewal (needs approval), ACTIVE
 * for an automatic one.
 */
async function createSuccessor(
  tx: DbClient,
  source: Contract,
  opts: { status: 'DRAFT' | 'ACTIVE'; actorId: string | null; now?: Date },
): Promise<string> {
  const version = await tx.contractVersion.findUniqueOrThrow({
    where: { contractId_versionNumber: { contractId: source.id, versionNumber: source.currentVersionNumber } },
    include: { clauses: { orderBy: { position: 'asc' } }, file: { select: { sha256: true } } },
  });
  const term = nextTerm(source);
  const content: ContractContent = {
    ...contentOf(version),
    startDate: term.startDate.toISOString().slice(0, 10),
    endDate: term.endDate.toISOString().slice(0, 10),
  };
  const auto = opts.status === 'ACTIVE';
  const successor = await tx.contract.create({
    data: {
      ...headFields(content),
      status: opts.status,
      ownerId: source.ownerId,
      departmentId: source.departmentId,
      autoRenew: source.autoRenew,
      renewalOfId: source.id,
      currentVersionNumber: 1,
      activatedAt: auto ? (opts.now ?? new Date()) : null,
    },
  });
  await writeVersion(tx, {
    contractId: successor.id,
    versionNumber: 1,
    content,
    fileId: version.fileId,
    templateId: version.templateId,
    changeSummary: `${auto ? 'Automatic renewal' : 'Renewal'} of ${source.referenceNumber}`,
    createdById: opts.actorId ?? source.ownerId,
  });
  await tx.contractStatusChange.create({
    data: {
      contractId: successor.id,
      fromStatus: null,
      toStatus: opts.status,
      actorId: opts.actorId,
      reason: auto ? `Renewed automatically from ${source.referenceNumber} on the same terms` : `Renewal of ${source.referenceNumber}`,
    },
  });
  await recordAudit(
    {
      action: 'CONTRACT_CREATED',
      entityType: 'contract',
      entityId: successor.id,
      contractId: successor.id,
      userId: opts.actorId,
      metadata: { referenceNumber: successor.referenceNumber, renewalOf: source.referenceNumber, automatic: auto, contentHash: computeContentHash(content) },
    },
    tx,
  );
  return successor.id;
}

/**
 * Called when a contract becomes SIGNED or ACTIVE: if it renews an EXPIRED
 * contract, that one is now RENEWED. (An ACTIVE predecessor is handled at its
 * end of term.)
 */
export async function settlePredecessor(tx: DbClient, contract: Contract, actorId: string | null) {
  if (!contract.renewalOfId) return;
  const previous = await tx.contract.findUnique({ where: { id: contract.renewalOfId } });
  if (previous?.status !== 'EXPIRED') return;
  await transitionContract(tx, { contractId: previous.id, from: 'EXPIRED', to: 'RENEWED', actorId, reason: `Renewed by ${contract.referenceNumber}` });
  await recordAudit({ action: 'CONTRACT_RENEWED', entityType: 'contract', entityId: previous.id, contractId: previous.id, userId: actorId, metadata: { renewal: contract.referenceNumber } }, tx);
}

async function lockContract(tx: DbClient, contractId: string): Promise<Contract> {
  await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
  return tx.contract.findUniqueOrThrow({ where: { id: contractId } });
}
