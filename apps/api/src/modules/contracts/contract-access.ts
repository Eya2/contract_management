import type { AuthUser } from '../../common/auth/auth-user.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ApprovalStepStatus, Role } from '../../generated/prisma/enums.js';

/**
 * RBAC layer 2 — record-level access to contracts, in one place.
 *
 * The naive rule "users only see their department's contracts" breaks the
 * workflow: Legal and Finance reviewers sit in their own departments, yet must
 * review everyone's contracts. So visibility is the union of:
 *   1. contracts of the user's own department,
 *   2. contracts the user owns,
 *   3. contracts with an approval step the user can act on (now or later),
 *   4. contracts the user was escalated to,
 *   5. contracts the user must sign.
 * Admins see everything.
 *
 * Every contract query goes through `contractVisibilityFilter`, so a new
 * endpoint can't forget the rule, and detail lookups use it too: a contract
 * outside your scope is a 404, not a 403, so its existence isn't revealed.
 */

/** Steps that make a contract visible to their approvers. SKIPPED/CANCELLED steps never reached them. */
const VISIBLE_STEP_STATUSES: ApprovalStepStatus[] = ['WAITING', 'PENDING', 'APPROVED', 'REJECTED'];

/** Steps this user is an eligible approver for, regardless of status. */
export function approverStepMatch(user: AuthUser): Prisma.ApprovalStepWhereInput {
  return {
    OR: [
      { assigneeId: user.id },
      {
        assigneeId: null,
        approverRole: user.role,
        OR: [{ approverDepartmentId: null }, { approverDepartmentId: user.departmentId }],
      },
    ],
  };
}

/**
 * "Pending my approval": steps this user can decide right now. That's the
 * steps routed to them plus the ones escalated to them, minus anything on a
 * contract they own or submitted (nobody approves their own contract).
 */
export function actionableStepFilter(user: AuthUser): Prisma.ApprovalStepWhereInput {
  return {
    AND: [
      { status: 'PENDING', request: { status: 'IN_PROGRESS' } },
      { OR: [approverStepMatch(user), { escalations: { some: { escalatedToId: user.id } } }] },
      { NOT: { request: { OR: [{ submittedById: user.id }, { contract: { ownerId: user.id } }] } } },
    ],
  };
}

export function contractVisibilityFilter(user: AuthUser): Prisma.ContractWhereInput {
  if (user.role === 'ADMIN') return {};

  return {
    OR: [
      { departmentId: user.departmentId },
      { ownerId: user.id },
      {
        approvalRequests: {
          some: {
            steps: {
              some: {
                OR: [
                  { AND: [{ status: { in: VISIBLE_STEP_STATUSES } }, approverStepMatch(user)] },
                  { escalations: { some: { escalatedToId: user.id } } },
                ],
              },
            },
          },
        },
      },
      { signers: { some: { userId: user.id } } },
    ],
  };
}

/**
 * In-memory twin of `actionableStepFilter`, used when a step is already loaded.
 *
 * `requesterIds` are the contract owner and the submitter: segregation of
 * duties means they can never decide a step of their own request, whatever
 * their role (admins included). `escalatedToIds` are the people the step was
 * escalated to, who may decide it in place of the original approvers.
 */
export function canActOnStep(
  user: AuthUser,
  step: {
    status: ApprovalStepStatus;
    approverRole: Role;
    approverDepartmentId: string | null;
    assigneeId: string | null;
  },
  context: { requesterIds?: string[]; escalatedToIds?: string[] } = {},
): boolean {
  if (step.status !== 'PENDING') return false;
  if (context.requesterIds?.includes(user.id)) return false;
  if (context.escalatedToIds?.includes(user.id)) return true;
  if (step.assigneeId) return step.assigneeId === user.id;
  return (
    step.approverRole === user.role &&
    (step.approverDepartmentId === null || step.approverDepartmentId === user.departmentId)
  );
}
