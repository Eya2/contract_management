import type { AuthUser } from '../../common/auth/auth-user.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import type { Contract, Prisma } from '../../generated/prisma/client.js';
import type { Role } from '../../generated/prisma/enums.js';
import { prisma, type DbClient } from '../../lib/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { actionableStepFilter, canActOnStep, contractVisibilityFilter } from '../contracts/contract-access.js';
import { transitionContract } from '../contracts/contract-status.js';
import { findVisibleOrThrow } from '../contracts/contract.service.js';
import { contractLink, notify } from '../notifications/notification.service.js';
import { describeCondition, factsFor, ConditionSchema } from './workflow-conditions.js';
import {
  applyDecision,
  materializeSteps,
  NoEligibleApproverError,
  openNextStage,
  routeStep,
  selectTemplate,
  type Activation,
  type Person,
} from './workflow-engine.js';

/**
 * Runs the approval workflow: the transactional shell around the pure engine.
 *
 * Every operation on a contract's workflow starts by locking the contract row
 * (`SELECT … FOR UPDATE`). That serializes submit / decide / withdraw for one
 * contract, which matters most for parallel steps: without the lock, two
 * approvers finishing the same stage at the same instant would each still see
 * the other's step as PENDING, and neither would open the next stage.
 * Contracts are always locked before anything else, so there's no lock-order
 * deadlock between these operations.
 */

const userSummary = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

const stepSelect = {
  id: true,
  stage: true,
  name: true,
  approverRole: true,
  approverDepartmentId: true,
  approverDepartment: { select: { id: true, name: true, code: true } },
  assigneeId: true,
  assignee: userSummary,
  status: true,
  routingNote: true,
  skipReason: true,
  slaHours: true,
  activatedAt: true,
  dueAt: true,
  decidedAt: true,
  decidedBy: userSummary,
  comment: true,
  escalationLevel: true,
  escalations: {
    select: { level: true, createdAt: true, escalatedToId: true, escalatedTo: userSummary },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ApprovalStepSelect;

const requestSelect = {
  id: true,
  status: true,
  currentStage: true,
  submittedAt: true,
  completedAt: true,
  submittedById: true,
  submittedBy: userSummary,
  contractVersion: { select: { id: true, versionNumber: true, contentHash: true } },
  workflowTemplate: { select: { id: true, name: true } },
  contract: { select: { ownerId: true } },
  steps: { select: stepSelect, orderBy: [{ stage: 'asc' }, { name: 'asc' }] },
} satisfies Prisma.ApprovalRequestSelect;

export const approvalService = {
  /** Which policy would apply if the contract were submitted now, and which steps it would skip. */
  async preview(user: AuthUser, contractId: string) {
    const contract = await findVisibleOrThrow(user, contractId);
    const templates = await prisma.workflowTemplate.findMany({ where: { isActive: true }, include: { steps: true } });
    const template = selectTemplate(templates, contract);
    if (!template) return { template: null, steps: [] };
    const planned = materializeSteps(template.steps, factsFor(contract), contract.departmentId);
    return {
      template: { id: template.id, name: template.name },
      steps: planned.map((p) => {
        const source = template.steps.find((s) => s.id === p.templateStepId)!;
        return {
          stage: p.stage,
          name: p.name,
          approverRole: p.approverRole,
          approverDepartmentId: p.approverDepartmentId,
          condition: source.condition ? describeCondition(ConditionSchema.parse(source.condition)) : null,
          willRun: p.status !== 'SKIPPED',
          skipReason: p.skipReason,
          slaHours: p.slaHours,
        };
      }),
    };
  },

  /**
   * Submits the current version for approval: picks the policy, freezes its
   * steps into an ApprovalRequest bound to this exact version, and opens the
   * first stage. A request where every step is skipped is approved at once.
   */
  async submit(user: AuthUser, contractId: string, comment?: string) {
    const visible = await findVisibleOrThrow(user, contractId);
    assertOwnerOrAdmin(user, visible);

    await prisma.$transaction(async (tx) => {
      const contract = await lockContract(tx, contractId);
      if (contract.status !== 'DRAFT') {
        throw new ConflictError(`Only drafts can be submitted (this contract is ${contract.status})`);
      }
      const version = await tx.contractVersion.findUniqueOrThrow({
        where: { contractId_versionNumber: { contractId, versionNumber: contract.currentVersionNumber } },
        select: { id: true, versionNumber: true, fileId: true, _count: { select: { clauses: true } } },
      });
      if (!version.fileId && version._count.clauses === 0) {
        throw new BadRequestError('Add clauses or upload a document before submitting');
      }

      const templates = await tx.workflowTemplate.findMany({ where: { isActive: true }, include: { steps: true } });
      const template = selectTemplate(templates, contract);
      if (!template) {
        throw new ConflictError('No approval workflow applies to this contract. Ask an admin to configure one.');
      }

      const requesterIds = [...new Set([contract.ownerId, user.id])];
      const planned = materializeSteps(template.steps, factsFor(contract), contract.departmentId);
      const rows: Prisma.ApprovalStepCreateManyInput[] = [];
      const request = await tx.approvalRequest.create({
        data: {
          contractId,
          contractVersionId: version.id,
          workflowTemplateId: template.id,
          submittedById: user.id,
        },
      });
      for (const p of planned) {
        let route: { assigneeId: string; routingNote: string } | null = null;
        if (p.status !== 'SKIPPED') {
          try {
            route = routeStep(p, await eligibleApprovers(tx, p), requesterIds, await fallbackApprovers(tx, p));
          } catch (err) {
            if (err instanceof NoEligibleApproverError) {
              throw new ConflictError(`${err.message}. Ask an admin to review the approval policy or user roles.`);
            }
            throw err;
          }
        }
        rows.push({
          requestId: request.id,
          templateStepId: p.templateStepId,
          stage: p.stage,
          name: p.name,
          approverRole: p.approverRole,
          approverDepartmentId: p.approverDepartmentId,
          status: p.status,
          skipReason: p.skipReason,
          slaHours: p.slaHours,
          assigneeId: route?.assigneeId ?? null,
          routingNote: route?.routingNote ?? null,
        });
      }
      const steps = rows.length
        ? await tx.approvalStep.createManyAndReturn({
            data: rows,
            select: { id: true, stage: true, status: true, slaHours: true },
          })
        : [];

      await transitionContract(tx, { contractId, from: 'DRAFT', to: 'SUBMITTED', actorId: user.id, reason: comment });
      await recordAudit(
        {
          action: 'CONTRACT_SUBMITTED',
          entityType: 'approval_request',
          entityId: request.id,
          contractId,
          metadata: {
            versionNumber: version.versionNumber,
            workflowTemplate: template.name,
            steps: rows.map((r) => ({ stage: r.stage, name: r.name, status: r.status, skipReason: r.skipReason ?? null })),
          },
        },
        tx,
      );

      const now = new Date();
      const first = openNextStage(steps, now);
      if (first) {
        await activate(tx, first.activations);
        await tx.approvalRequest.update({ where: { id: request.id }, data: { currentStage: first.stage } });
        await notifyApprovers(tx, contract, first.activations, requesterIds);
      } else {
        await tx.approvalRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', completedAt: now } });
        await transitionContract(tx, {
          contractId,
          from: 'SUBMITTED',
          to: 'APPROVED',
          actorId: null,
          reason: 'No approval step applies to this contract',
        });
        await recordAudit(
          { action: 'CONTRACT_APPROVED', entityType: 'approval_request', entityId: request.id, contractId, metadata: { automatic: true } },
          tx,
        );
        await notifyOwner(tx, contract, 'CONTRACT_APPROVED', 'is approved', 'No approval step applied, so it was approved automatically.');
      }
    });
    return this.listForContract(user, contractId);
  },

  /**
   * Records one approver's decision. The step update is compare-and-set
   * (`WHERE status = 'PENDING'`), so a second click, or a second approver acting
   * on the same step, gets a 409 instead of a double decision.
   */
  async decide(user: AuthUser, stepId: string, decision: 'APPROVED' | 'REJECTED', comment?: string) {
    if (decision === 'REJECTED' && !comment?.trim()) throw new BadRequestError('A reason is required to reject');

    const found = await prisma.approvalStep.findFirst({
      where: { id: stepId, request: { contract: contractVisibilityFilter(user) } },
      select: { request: { select: { contractId: true } } },
    });
    if (!found) throw new NotFoundError('Approval step');
    const contractId = found.request.contractId;

    await prisma.$transaction(async (tx) => {
      const contract = await lockContract(tx, contractId);
      const step = await tx.approvalStep.findUniqueOrThrow({
        where: { id: stepId },
        include: {
          escalations: { select: { escalatedToId: true } },
          request: { include: { steps: { select: { id: true, stage: true, status: true, slaHours: true } } } },
        },
      });
      const request = step.request;
      if (request.status !== 'IN_PROGRESS') {
        throw new ConflictError(`This approval request is already ${request.status.toLowerCase().replace('_', ' ')}`);
      }
      if (step.status !== 'PENDING') {
        throw new ConflictError(
          step.status === 'WAITING' ? 'This step opens once the previous stage is approved' : `This step is already ${step.status.toLowerCase()}`,
        );
      }
      const requesterIds = [contract.ownerId, request.submittedById];
      const allowed = canActOnStep(user, step, {
        requesterIds,
        escalatedToIds: step.escalations.map((e) => e.escalatedToId),
      });
      if (!allowed) {
        throw new ForbiddenError(
          requesterIds.includes(user.id) ? 'You cannot approve your own contract' : 'You are not an approver for this step',
        );
      }

      const now = new Date();
      const outcome = applyDecision(request.steps, stepId, decision, now);
      const { count } = await tx.approvalStep.updateMany({
        where: { id: stepId, status: 'PENDING' },
        data: { status: decision, decidedById: user.id, decidedAt: now, comment: comment?.trim() || null },
      });
      if (count !== 1) throw new ConflictError('This step was decided in the meantime');
      await recordAudit(
        {
          action: decision === 'APPROVED' ? 'APPROVAL_STEP_APPROVED' : 'APPROVAL_STEP_REJECTED',
          entityType: 'approval_step',
          entityId: stepId,
          contractId,
          metadata: { step: step.name, stage: step.stage, requestId: request.id, comment: comment ?? null },
        },
        tx,
      );

      const who = await actorName(tx, user.id);
      switch (outcome.kind) {
        case 'REJECTED': {
          await tx.approvalStep.updateMany({ where: { id: { in: outcome.cancelledIds } }, data: { status: 'CANCELLED' } });
          await tx.approvalRequest.update({
            where: { id: request.id },
            data: { status: 'REJECTED', completedAt: now, currentStage: null },
          });
          await transitionContract(tx, {
            contractId,
            from: contract.status,
            to: 'REJECTED',
            actorId: user.id,
            reason: `${step.name}: ${comment!.trim()}`,
          });
          await recordAudit(
            { action: 'CONTRACT_REJECTED', entityType: 'approval_request', entityId: request.id, contractId, metadata: { step: step.name } },
            tx,
          );
          await notifyOwner(tx, contract, 'CONTRACT_REJECTED', 'was rejected', `${who} rejected it at "${step.name}": ${comment!.trim()}`, request.submittedById);
          break;
        }
        case 'APPROVED': {
          await tx.approvalRequest.update({
            where: { id: request.id },
            data: { status: 'APPROVED', completedAt: now, currentStage: null },
          });
          await transitionContract(tx, { contractId, from: contract.status, to: 'APPROVED', actorId: user.id, reason: `Final approval: ${step.name}` });
          await recordAudit(
            { action: 'CONTRACT_APPROVED', entityType: 'approval_request', entityId: request.id, contractId },
            tx,
          );
          await notifyOwner(tx, contract, 'CONTRACT_APPROVED', 'is approved', `All approvals are in (last: ${who}, "${step.name}").`, request.submittedById);
          break;
        }
        case 'NEXT_STAGE':
        case 'STAGE_IN_PROGRESS': {
          if (contract.status === 'SUBMITTED') {
            await transitionContract(tx, { contractId, from: 'SUBMITTED', to: 'UNDER_REVIEW', actorId: user.id, reason: `First approval: ${step.name}` });
          }
          await notifyOwner(tx, contract, 'APPROVAL_GRANTED', 'passed a review step', `${who} approved "${step.name}".`, request.submittedById);
          if (outcome.kind === 'NEXT_STAGE') {
            await activate(tx, outcome.activations);
            await tx.approvalRequest.update({ where: { id: request.id }, data: { currentStage: outcome.stage } });
            await notifyApprovers(tx, contract, outcome.activations, requesterIds);
          }
          break;
        }
      }
    });
    return this.listForContract(user, contractId);
  },

  /** The owner pulls the contract back out of review; it returns to DRAFT. */
  async withdraw(user: AuthUser, contractId: string, reason?: string) {
    const visible = await findVisibleOrThrow(user, contractId);
    assertOwnerOrAdmin(user, visible);
    await prisma.$transaction(async (tx) => {
      const contract = await lockContract(tx, contractId);
      const request = await tx.approvalRequest.findFirst({ where: { contractId, status: 'IN_PROGRESS' } });
      if (!request) throw new ConflictError('This contract has no approval in progress');
      await tx.approvalStep.updateMany({
        where: { requestId: request.id, status: { in: ['WAITING', 'PENDING'] } },
        data: { status: 'CANCELLED' },
      });
      await tx.approvalRequest.update({
        where: { id: request.id },
        data: { status: 'WITHDRAWN', completedAt: new Date(), currentStage: null },
      });
      await transitionContract(tx, { contractId, from: contract.status, to: 'DRAFT', actorId: user.id, reason: reason ?? 'Withdrawn from review' });
      await recordAudit(
        { action: 'CONTRACT_WITHDRAWN', entityType: 'approval_request', entityId: request.id, contractId, metadata: { reason: reason ?? null } },
        tx,
      );
    });
    return this.listForContract(user, contractId);
  },

  /**
   * Reopens an approved (not yet signed) contract for editing. The approval
   * stays on record for the version it covered; the next version needs its own.
   */
  async reopen(user: AuthUser, contractId: string, reason: string) {
    const visible = await findVisibleOrThrow(user, contractId);
    assertOwnerOrAdmin(user, visible);
    await prisma.$transaction(async (tx) => {
      const contract = await lockContract(tx, contractId);
      if (contract.status !== 'APPROVED') throw new ConflictError('Only an approved, unsigned contract can be reopened');
      if (await tx.contractSigner.count({
          where: { contractId, status: 'SIGNED', version: { versionNumber: contract.currentVersionNumber } },
        })) {
        throw new ConflictError('Someone has already signed this contract; it can no longer be reopened');
      }
      await transitionContract(tx, { contractId, from: 'APPROVED', to: 'DRAFT', actorId: user.id, reason });
      await recordAudit({ action: 'CONTRACT_REOPENED', entityType: 'contract', entityId: contractId, contractId, metadata: { reason } }, tx);
    });
  },

  /** Every review round of a contract, newest first, with `canDecide` per step for the caller. */
  async listForContract(user: AuthUser, contractId: string) {
    await findVisibleOrThrow(user, contractId);
    const requests = await prisma.approvalRequest.findMany({
      where: { contractId },
      select: requestSelect,
      orderBy: { submittedAt: 'desc' },
    });
    return requests.map(({ contract, submittedById, ...r }) => ({
      ...r,
      steps: r.steps.map(({ approverDepartmentId, assigneeId, escalations, ...s }) => ({
        ...s,
        escalations: escalations.map(({ escalatedToId: _, ...e }) => e),
        canDecide:
          r.status === 'IN_PROGRESS' &&
          canActOnStep(user, { ...s, approverDepartmentId, assigneeId }, {
            requesterIds: [contract.ownerId, submittedById],
            escalatedToIds: escalations.map((e) => e.escalatedToId),
          }),
      })),
    }));
  },

  /** "Pending my approval": the caller's queue, most urgent first. */
  async pending(user: AuthUser) {
    const now = new Date();
    const steps = await prisma.approvalStep.findMany({
      where: actionableStepFilter(user),
      select: {
        ...stepSelect,
        request: {
          select: {
            id: true,
            submittedAt: true,
            submittedBy: userSummary,
            contractVersion: { select: { versionNumber: true } },
            contract: {
              select: {
                id: true,
                referenceNumber: true,
                title: true,
                type: true,
                status: true,
                value: true,
                currency: true,
                counterparty: { select: { id: true, name: true } },
                department: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
      },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { activatedAt: 'asc' }],
    });
    return steps.map(({ escalations, ...s }) => ({
      ...s,
      escalatedToMe: escalations.some((e) => e.escalatedToId === user.id),
      overdue: s.dueAt !== null && s.dueAt < now,
    }));
  },
};

// -----------------------------------------------------------------------------
//  Helpers
// -----------------------------------------------------------------------------

function assertOwnerOrAdmin(user: AuthUser, contract: Contract) {
  if (user.role !== 'ADMIN' && contract.ownerId !== user.id) {
    throw new ForbiddenError('Only the contract owner or an admin can do this');
  }
}

/** Locks the contract row for the rest of the transaction and returns its current state. */
async function lockContract(tx: DbClient, contractId: string): Promise<Contract> {
  await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
  return tx.contract.findUniqueOrThrow({ where: { id: contractId } });
}

async function activate(tx: DbClient, activations: Activation[]) {
  for (const a of activations) {
    await tx.approvalStep.updateMany({
      where: { id: a.id, status: 'WAITING' },
      data: { status: 'PENDING', activatedAt: a.activatedAt, dueAt: a.dueAt },
    });
  }
}

const personName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

/** Active users whose role (and department, for scoped steps) lets them act on the step. */
async function eligibleApprovers(
  tx: DbClient,
  step: { approverRole: Role; approverDepartmentId: string | null },
): Promise<Person[]> {
  const users = await tx.user.findMany({
    where: {
      isActive: true,
      role: step.approverRole,
      ...(step.approverDepartmentId ? { departmentId: step.approverDepartmentId } : {}),
    },
    select: { id: true, firstName: true, lastName: true },
  });
  return users.map((u) => ({ id: u.id, name: personName(u) }));
}

/** Who takes a step no one else can: the approver department's head, then the admins. */
async function fallbackApprovers(
  tx: DbClient,
  step: { approverDepartmentId: string | null },
): Promise<(Person & { label: string })[]> {
  const result: (Person & { label: string })[] = [];
  if (step.approverDepartmentId) {
    const dept = await tx.department.findUnique({
      where: { id: step.approverDepartmentId },
      select: { name: true, head: { select: { id: true, firstName: true, lastName: true, isActive: true } } },
    });
    if (dept?.head?.isActive) result.push({ id: dept.head.id, name: personName(dept.head), label: `head of ${dept.name}` });
  }
  const admins = await tx.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { createdAt: 'asc' },
  });
  result.push(...admins.map((a) => ({ id: a.id, name: personName(a), label: 'admin' })));
  return result;
}

/** Tells the approvers of newly opened steps that a contract is waiting for them. */
async function notifyApprovers(tx: DbClient, contract: Contract, activations: Activation[], requesterIds: string[]) {
  const steps = await tx.approvalStep.findMany({
    where: { id: { in: activations.map((a) => a.id) } },
    select: { id: true, name: true, approverRole: true, approverDepartmentId: true, assigneeId: true, dueAt: true },
  });
  for (const step of steps) {
    const recipients = step.assigneeId
      ? [step.assigneeId]
      : (await eligibleApprovers(tx, step)).map((p) => p.id).filter((id) => !requesterIds.includes(id));
    await notify(tx, recipients, {
      type: 'APPROVAL_REQUESTED',
      title: `Approval needed: ${contract.referenceNumber} ${contract.title}`,
      body: `"${step.name}" is waiting for your decision${step.dueAt ? ` (due ${step.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC)` : ''}.`,
      contractId: contract.id,
      link: contractLink(contract.id, 'approvals'),
      dedupeKey: `approval-requested:${step.id}`,
    });
  }
}

async function notifyOwner(
  tx: DbClient,
  contract: Contract,
  type: 'CONTRACT_APPROVED' | 'CONTRACT_REJECTED' | 'APPROVAL_GRANTED',
  /** Completes the title "<ref> <title> …", e.g. "was rejected". */
  outcome: string,
  body: string,
  submitterId?: string,
) {
  await notify(tx, [contract.ownerId, ...(submitterId ? [submitterId] : [])], {
    type,
    title: `${contract.referenceNumber} ${contract.title} ${outcome}`,
    body,
    contractId: contract.id,
    link: contractLink(contract.id, 'approvals'),
  });
}

async function actorName(tx: DbClient, userId: string): Promise<string> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
  return u ? personName(u) : 'Someone';
}
