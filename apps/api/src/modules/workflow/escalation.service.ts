import { logger } from '../../lib/logger.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { contractLink, notify } from '../notifications/notification.service.js';
import { MAX_ESCALATION_LEVEL, planEscalation } from './workflow-engine.js';

const overdueSelect = {
  id: true,
  name: true,
  status: true,
  dueAt: true,
  slaHours: true,
  escalationLevel: true,
  approverRole: true,
  approverDepartmentId: true,
  assigneeId: true,
  request: {
    select: {
      submittedById: true,
      contract: { select: { id: true, ownerId: true, referenceNumber: true, title: true } },
    },
  },
} satisfies Prisma.ApprovalStepSelect;

type OverdueStep = Prisma.ApprovalStepGetPayload<{ select: typeof overdueSelect }>;

/**
 * Escalates PENDING steps that have gone past their due date.
 *
 *   level 1: the head of the approver department (for company-wide steps, the
 *            heads of departments led by someone holding the approver role,
 *            e.g. the Legal head for a Legal step);
 *   level 2: every admin.
 *
 * Escalation adds people who may decide the step; the original approvers
 * can still act. Each level re-arms the due date for another SLA window.
 *
 * Safe to run concurrently or repeatedly: the level bump is compare-and-set on
 * `escalationLevel`, escalation rows are unique per (step, level, person), and
 * emails carry a dedupe key. A second scanner, or a retry after a crash, can't
 * escalate or notify twice.
 */
export const escalationService = {
  async runOnce(now = new Date(), batchSize = 100): Promise<{ escalated: number }> {
    const overdue = await prisma.approvalStep.findMany({
      where: {
        status: 'PENDING',
        dueAt: { lte: now },
        escalationLevel: { lt: MAX_ESCALATION_LEVEL },
        request: { status: 'IN_PROGRESS' },
      },
      select: overdueSelect,
      orderBy: { dueAt: 'asc' },
      take: batchSize,
    });

    let escalated = 0;
    for (const step of overdue) {
      try {
        if (await escalateStep(step, now)) escalated++;
      } catch (err) {
        // One bad step must not block the rest of the batch.
        logger.error({ err, stepId: step.id }, 'Escalation failed');
      }
    }
    return { escalated };
  },
};

async function escalateStep(step: OverdueStep, now: Date): Promise<boolean> {
  const { contract } = step.request;
  const requesterIds = [contract.ownerId, step.request.submittedById];

  const heads = step.escalationLevel === 0 && !step.assigneeId ? await departmentHeads(step) : [];
  const eligibleHeads = heads.filter((id) => !requesterIds.includes(id));
  const plan = planEscalation(step, now, eligibleHeads.length > 0);
  if (!plan) return false;

  const targets =
    plan.level === 1
      ? eligibleHeads
      : (await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } }))
          .map((u) => u.id)
          .filter((id) => !requesterIds.includes(id));

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.approvalStep.updateMany({
      where: { id: step.id, status: 'PENDING', escalationLevel: step.escalationLevel },
      data: { escalationLevel: plan.level, dueAt: plan.nextDueAt },
    });
    if (count !== 1) return false; // decided or escalated by someone else in the meantime

    if (targets.length === 0) {
      logger.warn({ stepId: step.id, level: plan.level }, 'Overdue approval step has no one to escalate to');
    }
    await tx.approvalEscalation.createMany({
      data: targets.map((escalatedToId) => ({ stepId: step.id, level: plan.level, escalatedToId })),
      skipDuplicates: true,
    });
    await recordAudit(
      {
        action: 'APPROVAL_ESCALATED',
        entityType: 'approval_step',
        entityId: step.id,
        contractId: contract.id,
        userId: null,
        metadata: { step: step.name, level: plan.level, escalatedTo: targets, dueAt: step.dueAt?.toISOString() ?? null },
      },
      tx,
    );
    await notify(tx, targets, {
      type: 'APPROVAL_ESCALATED',
      title: `Overdue approval: ${contract.referenceNumber} ${contract.title}`,
      body: `"${step.name}" has been waiting past its deadline and was escalated to you. You can decide it directly.`,
      contractId: contract.id,
      link: contractLink(contract.id, 'approvals'),
      dedupeKey: `escalation:${step.id}:${plan.level}`,
    });
    return true;
  });
}

async function departmentHeads(step: Pick<OverdueStep, 'approverRole' | 'approverDepartmentId'>) {
  const departments = await prisma.department.findMany({
    where: step.approverDepartmentId
      ? { id: step.approverDepartmentId }
      : { head: { role: step.approverRole } },
    select: { head: { select: { id: true, isActive: true } } },
  });
  return departments.flatMap((d) => (d.head?.isActive ? [d.head.id] : []));
}
