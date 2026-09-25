import type { Role } from '../../generated/prisma/enums.js';

/**
 * Role-based access control, layer 1: *what kind* of action a role may perform.
 *
 * Kept in code rather than in the database: there are five fixed roles, and a
 * permission change is a behaviour change that deserves code review, a test and
 * a commit, not a silent row update.
 *
 * Layer 2 — *which records* (department scoping, ownership, being the assigned
 * approver) — is enforced in the services; see contracts/contract-access.ts.
 */
export const Permission = {
  CONTRACT_READ: 'contract.read',
  CONTRACT_CREATE: 'contract.create',
  /** Edit content (creates a new version). Non-admins may only edit their own drafts. */
  CONTRACT_UPDATE: 'contract.update',
  CONTRACT_SUBMIT: 'contract.submit',
  CONTRACT_SIGN: 'contract.sign',
  CONTRACT_TERMINATE: 'contract.terminate',
  APPROVAL_DECIDE: 'approval.decide',
  COMMENT_CREATE: 'comment.create',
  AUDIT_READ: 'audit.read',
  USER_MANAGE: 'user.manage',
  WORKFLOW_MANAGE: 'workflow.manage',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL_PERMISSIONS = Object.values(Permission);
const P = Permission;

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  ADMIN: ALL_PERMISSIONS,
  LEGAL: [
    P.CONTRACT_READ, P.CONTRACT_CREATE, P.CONTRACT_UPDATE, P.CONTRACT_SUBMIT,
    P.APPROVAL_DECIDE, P.COMMENT_CREATE, P.AUDIT_READ,
  ],
  MANAGER: [
    P.CONTRACT_READ, P.CONTRACT_CREATE, P.CONTRACT_UPDATE, P.CONTRACT_SUBMIT,
    P.CONTRACT_SIGN, P.CONTRACT_TERMINATE, P.APPROVAL_DECIDE, P.COMMENT_CREATE,
  ],
  FINANCE: [P.CONTRACT_READ, P.APPROVAL_DECIDE, P.COMMENT_CREATE],
  EMPLOYEE: [P.CONTRACT_READ, P.CONTRACT_CREATE, P.CONTRACT_UPDATE, P.CONTRACT_SUBMIT, P.COMMENT_CREATE],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
