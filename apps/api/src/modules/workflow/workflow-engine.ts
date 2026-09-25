import type { ApprovalStepStatus, ApproverScope, ContractType, Role } from '../../generated/prisma/enums.js';
import { ConditionSchema, evaluateCondition, type ConditionFacts } from './workflow-conditions.js';

/**
 * The approval workflow engine: pure functions over plain data.
 *
 * The service loads rows, calls these functions to decide *what should happen*,
 * and writes the result in one transaction. Keeping the decisions free of
 * Prisma and Express is what lets every rule (stage ordering, parallel steps,
 * skipping, rejection, escalation) be unit-tested exhaustively.
 *
 *   submit ─▶ selectTemplate ─▶ materializeSteps ─▶ openNextStage
 *   decide ─▶ applyDecision ─▶ (stage still open | next stage | APPROVED | REJECTED)
 *   scan   ─▶ planEscalation
 */

// -----------------------------------------------------------------------------
//  Template selection
// -----------------------------------------------------------------------------

export interface TemplateCandidate {
  id: string;
  contractType: ContractType | null;
  departmentId: string | null;
  createdAt: Date;
}

/**
 * Picks the most specific active template for a contract:
 * type + department > type > department > default (neither set).
 * A template scoped to another type or department never applies. Ties go to
 * the most recently created template.
 */
export function selectTemplate<T extends TemplateCandidate>(
  templates: T[],
  contract: { type: ContractType; departmentId: string },
): T | null {
  const score = (t: T) =>
    (t.contractType === null ? 0 : t.contractType === contract.type ? 2 : -Infinity) +
    (t.departmentId === null ? 0 : t.departmentId === contract.departmentId ? 1 : -Infinity);
  const ranked = templates
    .map((t) => ({ t, s: score(t) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => b.s - a.s || b.t.createdAt.getTime() - a.t.createdAt.getTime());
  return ranked[0]?.t ?? null;
}

// -----------------------------------------------------------------------------
//  Materializing steps at submission
// -----------------------------------------------------------------------------

export interface StepTemplate {
  id: string;
  stage: number;
  name: string;
  approverRole: Role;
  approverScope: ApproverScope;
  condition: unknown;
  escalateAfterHours: number | null;
}

/** An ApprovalStep about to be inserted. */
export interface PlannedStep {
  templateStepId: string;
  stage: number;
  name: string;
  approverRole: Role;
  approverDepartmentId: string | null;
  status: ApprovalStepStatus;
  skipReason: string | null;
  slaHours: number | null;
  activatedAt: Date | null;
  dueAt: Date | null;
}

/**
 * Copies the template's steps into a frozen plan for one contract. Steps whose
 * condition doesn't hold are SKIPPED with the reason; the rest start WAITING.
 * CONTRACT_DEPARTMENT steps are pinned to the contract's department.
 */
export function materializeSteps(
  steps: StepTemplate[],
  facts: ConditionFacts,
  contractDepartmentId: string,
): PlannedStep[] {
  return [...steps]
    .sort((a, b) => a.stage - b.stage || a.name.localeCompare(b.name))
    .map((s) => {
      // Conditions are validated on save; re-parsing guards against rows edited by hand.
      const result = s.condition == null ? null : evaluateCondition(ConditionSchema.parse(s.condition), facts);
      const skipped = result !== null && !result.applies;
      return {
        templateStepId: s.id,
        stage: s.stage,
        name: s.name,
        approverRole: s.approverRole,
        approverDepartmentId: s.approverScope === 'CONTRACT_DEPARTMENT' ? contractDepartmentId : null,
        status: skipped ? 'SKIPPED' : 'WAITING',
        skipReason: skipped ? result.reason : null,
        slaHours: s.escalateAfterHours,
        activatedAt: null,
        dueAt: null,
      };
    });
}

// -----------------------------------------------------------------------------
//  Stage progression
// -----------------------------------------------------------------------------

/** The minimal step state the progression logic needs. */
export interface StepState {
  id: string;
  stage: number;
  status: ApprovalStepStatus;
  slaHours: number | null;
}

export interface Activation {
  id: string;
  activatedAt: Date;
  dueAt: Date | null;
}

export function dueDate(from: Date, slaHours: number | null): Date | null {
  return slaHours === null ? null : new Date(from.getTime() + slaHours * 3_600_000);
}

/**
 * Opens the lowest stage that still has WAITING steps: all its WAITING steps
 * become PENDING at once (parallel approval). Returns null when no stage is left.
 */
export function openNextStage(steps: StepState[], now: Date): { stage: number; activations: Activation[] } | null {
  const waiting = steps.filter((s) => s.status === 'WAITING');
  if (waiting.length === 0) return null;
  const stage = Math.min(...waiting.map((s) => s.stage));
  return {
    stage,
    activations: waiting
      .filter((s) => s.stage === stage)
      .map((s) => ({ id: s.id, activatedAt: now, dueAt: dueDate(now, s.slaHours) })),
  };
}

export type DecisionOutcome =
  /** Other steps of the same stage are still pending. */
  | { kind: 'STAGE_IN_PROGRESS' }
  /** The stage is complete and the next one opened. */
  | { kind: 'NEXT_STAGE'; stage: number; activations: Activation[] }
  /** That was the last approval: the request is approved. */
  | { kind: 'APPROVED' }
  /** Rejected: the request ends, every undecided step is cancelled. */
  | { kind: 'REJECTED'; cancelledIds: string[] };

/**
 * What a decision on `stepId` does to the rest of the request. `steps` is the
 * request's steps *before* the decision; the decided step must be PENDING.
 *
 * One rejection ends the whole request (any approver can veto). An approval
 * advances only when every step of the stage has approved.
 */
export function applyDecision(
  steps: StepState[],
  stepId: string,
  decision: 'APPROVED' | 'REJECTED',
  now: Date,
): DecisionOutcome {
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`Step ${stepId} is not part of this request`);
  if (step.status !== 'PENDING') throw new Error(`Step ${stepId} is ${step.status}, not PENDING`);

  if (decision === 'REJECTED') {
    return {
      kind: 'REJECTED',
      cancelledIds: steps.filter((s) => s.id !== stepId && (s.status === 'PENDING' || s.status === 'WAITING')).map((s) => s.id),
    };
  }

  const after = steps.map((s) => (s.id === stepId ? { ...s, status: 'APPROVED' as const } : s));
  if (after.some((s) => s.stage === step.stage && s.status === 'PENDING')) return { kind: 'STAGE_IN_PROGRESS' };
  const next = openNextStage(after, now);
  return next ? { kind: 'NEXT_STAGE', ...next } : { kind: 'APPROVED' };
}

// -----------------------------------------------------------------------------
//  Routing (segregation of duties)
// -----------------------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
}

/**
 * Nobody approves their own contract. If the requester is the only person who
 * could act on a step (e.g. a manager submitting their own contract, with the
 * step "Manager of the contract's department"), or nobody can at all, the step
 * is assigned to the first fallback who isn't the requester, with a note saying
 * why. Returns null when the step can keep its normal, role-based routing.
 *
 * @throws when no one at all can approve the step.
 */
export function routeStep(
  step: { name: string; approverRole: Role },
  eligible: Person[],
  requesterIds: string[],
  fallbacks: (Person & { label: string })[],
): { assigneeId: string; routingNote: string } | null {
  const others = eligible.filter((p) => !requesterIds.includes(p.id));
  if (others.length > 0) return null;

  const target = fallbacks.find((p) => !requesterIds.includes(p.id));
  if (!target) throw new NoEligibleApproverError(step.name);
  const why =
    eligible.length > 0
      ? `the only eligible ${roleName(step.approverRole)} is the requester`
      : `there is no active ${roleName(step.approverRole)} who can approve it`;
  return { assigneeId: target.id, routingNote: `Routed to ${target.name} (${target.label}) because ${why}.` };
}

export class NoEligibleApproverError extends Error {
  constructor(readonly stepName: string) {
    super(`No one is eligible to approve "${stepName}"`);
  }
}

function roleName(role: Role): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

// -----------------------------------------------------------------------------
//  Escalation
// -----------------------------------------------------------------------------

/** Level 1: head of the approver department. Level 2: admins. Nothing after that. */
export const MAX_ESCALATION_LEVEL = 2;

/**
 * For an overdue PENDING step: the next escalation level and the new due date
 * (another SLA window, so a still-ignored step escalates again later).
 * `hasDepartmentHead` false skips straight to the admins. Returns null when the
 * step isn't overdue or has reached the top level.
 */
export function planEscalation(
  step: { status: ApprovalStepStatus; dueAt: Date | null; escalationLevel: number; slaHours: number | null },
  now: Date,
  hasDepartmentHead: boolean,
): { level: number; nextDueAt: Date } | null {
  if (step.status !== 'PENDING' || !step.dueAt || step.dueAt > now) return null;
  const dueAt = step.dueAt;
  if (step.escalationLevel >= MAX_ESCALATION_LEVEL) return null;
  const level = step.escalationLevel === 0 && hasDepartmentHead ? 1 : MAX_ESCALATION_LEVEL;
  // At the top level the due date stays as it was: the step remains visibly overdue.
  return { level, nextDueAt: level < MAX_ESCALATION_LEVEL ? (dueDate(now, step.slaHours) ?? dueAt) : dueAt };
}
