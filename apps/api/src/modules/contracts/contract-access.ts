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

/** "Pending my approval": steps this user can decide right now. */
export function actionableStepFilter(user: AuthUser): Prisma.ApprovalStepWhereInput {
  return { AND: [{ status: 'PENDING' }, approverStepMatch(user)] };
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

/** In-memory twin of `approverStepMatch`, used when a step is already loaded. */
export function canActOnStep(
  user: AuthUser,
  step: {
    status: ApprovalStepStatus;
    approverRole: Role;
    approverDepartmentId: string | null;
    assigneeId: string | null;
  },
): boolean {
  if (step.status !== 'PENDING') return false;
  if (step.assigneeId) return step.assigneeId === user.id;
  return (
    step.approverRole === user.role &&
    (step.approverDepartmentId === null || step.approverDepartmentId === user.departmentId)
  );
}
