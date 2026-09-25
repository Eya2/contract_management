/**
 * Domain enums shared by the API and the web client.
 *
 * These are declared as `const` objects + string-literal union types rather than
 * TypeScript `enum`s: they erase cleanly, serialize as plain strings over JSON,
 * and stay structurally compatible with the enums Prisma generates on the API side
 * (the API has a compile-time test asserting the two stay in sync).
 */

export const Role = {
  ADMIN: 'ADMIN',
  LEGAL: 'LEGAL',
  MANAGER: 'MANAGER',
  FINANCE: 'FINANCE',
  EMPLOYEE: 'EMPLOYEE',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ContractType = {
  VENDOR: 'VENDOR',
  CLIENT: 'CLIENT',
  NDA: 'NDA',
  EMPLOYMENT: 'EMPLOYMENT',
} as const;
export type ContractType = (typeof ContractType)[keyof typeof ContractType];

export const ContractStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SIGNED: 'SIGNED',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  RENEWED: 'RENEWED',
  TERMINATED: 'TERMINATED',
} as const;
export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];

export const ApprovalStepStatus = {
  /** Belongs to a later stage; not actionable yet. */
  WAITING: 'WAITING',
  /** Current stage; awaiting a decision. */
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  /** Condition not met at submission time (e.g. Finance for low-value contracts). */
  SKIPPED: 'SKIPPED',
  /** The request ended (rejected / withdrawn) before this step was decided. */
  CANCELLED: 'CANCELLED',
} as const;
export type ApprovalStepStatus = (typeof ApprovalStepStatus)[keyof typeof ApprovalStepStatus];

export const ApprovalRequestStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type ApprovalRequestStatus = (typeof ApprovalRequestStatus)[keyof typeof ApprovalRequestStatus];
