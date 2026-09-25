import { describe, expect, it } from 'vitest';
import { Role } from '../../generated/prisma/enums.js';
import { Permission, ROLE_PERMISSIONS, hasPermission } from './permissions.js';

describe('role permissions', () => {
  it('grants admins every permission', () => {
    for (const p of Object.values(Permission)) expect(hasPermission('ADMIN', p)).toBe(true);
  });

  it('reserves user and workflow administration for admins', () => {
    for (const role of Object.values(Role).filter((r) => r !== 'ADMIN')) {
      expect(hasPermission(role, Permission.USER_MANAGE)).toBe(false);
      expect(hasPermission(role, Permission.WORKFLOW_MANAGE)).toBe(false);
    }
  });

  it('lets every approver role decide approvals, but not employees', () => {
    expect(hasPermission('LEGAL', Permission.APPROVAL_DECIDE)).toBe(true);
    expect(hasPermission('MANAGER', Permission.APPROVAL_DECIDE)).toBe(true);
    expect(hasPermission('FINANCE', Permission.APPROVAL_DECIDE)).toBe(true);
    expect(hasPermission('EMPLOYEE', Permission.APPROVAL_DECIDE)).toBe(false);
  });

  it('keeps Finance read-only on contract content', () => {
    expect(hasPermission('FINANCE', Permission.CONTRACT_CREATE)).toBe(false);
    expect(hasPermission('FINANCE', Permission.CONTRACT_UPDATE)).toBe(false);
  });

  it('gives every role read access and a declared permission list', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_PERMISSIONS[role]).toContain(Permission.CONTRACT_READ);
    }
  });
});
