import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { canActOnStep, contractVisibilityFilter } from './contract-access.js';

const user = (role: AuthUser['role'], departmentId = 'dept-sales', id = 'u1'): AuthUser => ({
  id,
  email: `${id}@test.dev`,
  role,
  departmentId,
});

const pendingStep = {
  status: 'PENDING' as const,
  approverRole: 'MANAGER' as const,
  approverDepartmentId: 'dept-sales',
  assigneeId: null,
};

describe('contractVisibilityFilter', () => {
  it('gives admins an unrestricted filter', () => {
    expect(contractVisibilityFilter(user('ADMIN'))).toEqual({});
  });

  it('scopes other roles to their department, ownership, approvals and signatures', () => {
    const filter = contractVisibilityFilter(user('EMPLOYEE'));
    expect(filter.OR).toHaveLength(4);
    expect(filter.OR).toContainEqual({ departmentId: 'dept-sales' });
    expect(filter.OR).toContainEqual({ ownerId: 'u1' });
    expect(filter.OR).toContainEqual({ signers: { some: { userId: 'u1' } } });
  });

  it('never exposes contracts through skipped or cancelled steps', () => {
    const json = JSON.stringify(contractVisibilityFilter(user('FINANCE')));
    expect(json).toContain('"in":["WAITING","PENDING","APPROVED","REJECTED"]');
    expect(json).not.toContain('SKIPPED');
  });
});

describe('canActOnStep', () => {
  it('lets a role-holder of the right department act on a pending step', () => {
    expect(canActOnStep(user('MANAGER'), pendingStep)).toBe(true);
  });

  it('rejects a manager from another department', () => {
    expect(canActOnStep(user('MANAGER', 'dept-procurement'), pendingStep)).toBe(false);
  });

  it('lets any holder of the role act on a company-wide step', () => {
    const legalStep = { ...pendingStep, approverRole: 'LEGAL' as const, approverDepartmentId: null };
    expect(canActOnStep(user('LEGAL', 'dept-legal'), legalStep)).toBe(true);
    expect(canActOnStep(user('MANAGER'), legalStep)).toBe(false);
  });

  it('restricts an explicitly assigned step to its assignee', () => {
    const assigned = { ...pendingStep, assigneeId: 'u2' };
    expect(canActOnStep(user('MANAGER', 'dept-sales', 'u1'), assigned)).toBe(false);
    expect(canActOnStep(user('EMPLOYEE', 'dept-other', 'u2'), assigned)).toBe(true);
  });

  it('never lets the owner or submitter decide their own contract, admins included', () => {
    const manager = user('MANAGER', 'dept-sales', 'u1');
    expect(canActOnStep(manager, pendingStep, { requesterIds: ['u1'] })).toBe(false);
    const assignedAdmin = user('ADMIN', 'dept-ops', 'u1');
    expect(canActOnStep(assignedAdmin, { ...pendingStep, assigneeId: 'u1' }, { requesterIds: ['u1'] })).toBe(false);
  });

  it('lets a person the step was escalated to decide it, whatever their role', () => {
    const head = user('ADMIN', 'dept-ops', 'head');
    expect(canActOnStep(head, pendingStep)).toBe(false);
    expect(canActOnStep(head, pendingStep, { escalatedToIds: ['head'] })).toBe(true);
    expect(canActOnStep(head, { ...pendingStep, status: 'APPROVED' }, { escalatedToIds: ['head'] })).toBe(false);
  });

  it('refuses steps that are not pending', () => {
    for (const status of ['WAITING', 'APPROVED', 'REJECTED', 'SKIPPED', 'CANCELLED'] as const) {
      expect(canActOnStep(user('MANAGER'), { ...pendingStep, status })).toBe(false);
    }
  });
});
