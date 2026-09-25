import { describe, expect, it } from 'vitest';
import type { ConditionFacts } from './workflow-conditions.js';
import {
  applyDecision,
  materializeSteps,
  NoEligibleApproverError,
  openNextStage,
  planEscalation,
  routeStep,
  selectTemplate,
  type StepState,
  type StepTemplate,
} from './workflow-engine.js';

const NOW = new Date('2026-09-25T10:00:00Z');
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

describe('selectTemplate', () => {
  const t = (id: string, contractType: 'VENDOR' | 'NDA' | null, departmentId: string | null, created = '2026-01-01') => ({
    id,
    contractType,
    departmentId,
    createdAt: new Date(created),
  });
  const templates = [
    t('default', null, null),
    t('vendor', 'VENDOR', null),
    t('sales', null, 'sales'),
    t('vendor-sales', 'VENDOR', 'sales'),
  ];

  it('prefers type + department, then type, then department, then the default', () => {
    expect(selectTemplate(templates, { type: 'VENDOR', departmentId: 'sales' })?.id).toBe('vendor-sales');
    expect(selectTemplate(templates, { type: 'VENDOR', departmentId: 'ops' })?.id).toBe('vendor');
    expect(selectTemplate(templates, { type: 'NDA', departmentId: 'sales' })?.id).toBe('sales');
    expect(selectTemplate(templates, { type: 'NDA', departmentId: 'ops' })?.id).toBe('default');
  });

  it('never picks a template scoped to another type or department', () => {
    const scoped = [t('nda', 'NDA', null), t('sales', null, 'sales')];
    expect(selectTemplate(scoped, { type: 'VENDOR', departmentId: 'ops' })).toBeNull();
  });

  it('breaks ties with the newest template', () => {
    const tied = [t('old', null, null, '2025-01-01'), t('new', null, null, '2026-06-01')];
    expect(selectTemplate(tied, { type: 'NDA', departmentId: 'x' })?.id).toBe('new');
  });
});

describe('materializeSteps', () => {
  const steps: StepTemplate[] = [
    { id: 'fin', stage: 2, name: 'Finance review', approverRole: 'FINANCE', approverScope: 'ANY', condition: { field: 'value', op: 'gt', value: 10000 }, escalateAfterHours: 48 },
    { id: 'mgr', stage: 1, name: 'Manager approval', approverRole: 'MANAGER', approverScope: 'CONTRACT_DEPARTMENT', condition: null, escalateAfterHours: 24 },
    { id: 'leg', stage: 2, name: 'Legal review', approverRole: 'LEGAL', approverScope: 'ANY', condition: null, escalateAfterHours: null },
  ];
  const facts = (value: number | null): ConditionFacts => ({ value, currency: 'USD', type: 'VENDOR', durationDays: null, autoRenew: false });

  it('orders by stage, skips steps whose condition fails, and pins department-scoped steps', () => {
    const planned = materializeSteps(steps, facts(8000), 'dept-sales');
    expect(planned.map((s) => [s.stage, s.name, s.status])).toEqual([
      [1, 'Manager approval', 'WAITING'],
      [2, 'Finance review', 'SKIPPED'],
      [2, 'Legal review', 'WAITING'],
    ]);
    expect(planned[0]!.approverDepartmentId).toBe('dept-sales');
    expect(planned[2]!.approverDepartmentId).toBeNull();
    expect(planned[1]!.skipReason).toBe('value 8,000.00 USD is not > 10,000');
    expect(planned[0]!.slaHours).toBe(24);
  });

  it('keeps conditional steps when they apply, or when the value is unknown', () => {
    expect(materializeSteps(steps, facts(50000), 'd').every((s) => s.status === 'WAITING')).toBe(true);
    expect(materializeSteps(steps, facts(null), 'd').every((s) => s.status === 'WAITING')).toBe(true);
  });
});

describe('stage progression', () => {
  const s = (id: string, stage: number, status: StepState['status'], slaHours: number | null = 24): StepState => ({ id, stage, status, slaHours });

  it('opens every waiting step of the lowest stage at once, with its due date', () => {
    const next = openNextStage([s('a', 2, 'WAITING'), s('b', 2, 'WAITING', null), s('c', 3, 'WAITING'), s('x', 1, 'SKIPPED')], NOW);
    expect(next).toEqual({
      stage: 2,
      activations: [
        { id: 'a', activatedAt: NOW, dueAt: hours(24) },
        { id: 'b', activatedAt: NOW, dueAt: null },
      ],
    });
  });

  it('returns null when nothing is left to open', () => {
    expect(openNextStage([s('a', 1, 'APPROVED'), s('b', 2, 'SKIPPED')], NOW)).toBeNull();
  });

  it('waits for every parallel step of a stage', () => {
    const steps = [s('legal', 2, 'PENDING'), s('finance', 2, 'PENDING'), s('exec', 3, 'WAITING')];
    expect(applyDecision(steps, 'legal', 'APPROVED', NOW)).toEqual({ kind: 'STAGE_IN_PROGRESS' });
  });

  it('opens the next stage when the last step of a stage approves', () => {
    const steps = [s('legal', 2, 'APPROVED'), s('finance', 2, 'PENDING'), s('exec', 3, 'WAITING', 8)];
    expect(applyDecision(steps, 'finance', 'APPROVED', NOW)).toEqual({
      kind: 'NEXT_STAGE',
      stage: 3,
      activations: [{ id: 'exec', activatedAt: NOW, dueAt: hours(8) }],
    });
  });

  it('jumps over stages whose steps were all skipped', () => {
    const steps = [s('mgr', 1, 'PENDING'), s('fin', 2, 'SKIPPED'), s('exec', 3, 'WAITING')];
    const outcome = applyDecision(steps, 'mgr', 'APPROVED', NOW);
    expect(outcome.kind === 'NEXT_STAGE' && outcome.stage).toBe(3);
  });

  it('approves the request on the final approval', () => {
    const steps = [s('mgr', 1, 'APPROVED'), s('legal', 2, 'PENDING'), s('fin', 2, 'SKIPPED')];
    expect(applyDecision(steps, 'legal', 'APPROVED', NOW)).toEqual({ kind: 'APPROVED' });
  });

  it('lets one rejection end the request and cancel everything undecided', () => {
    const steps = [s('mgr', 1, 'APPROVED'), s('legal', 2, 'PENDING'), s('fin', 2, 'PENDING'), s('exec', 3, 'WAITING'), s('x', 3, 'SKIPPED')];
    expect(applyDecision(steps, 'legal', 'REJECTED', NOW)).toEqual({ kind: 'REJECTED', cancelledIds: ['fin', 'exec'] });
  });

  it('refuses to decide a step that is not pending', () => {
    expect(() => applyDecision([s('a', 1, 'WAITING')], 'a', 'APPROVED', NOW)).toThrow(/not PENDING/);
    expect(() => applyDecision([s('a', 1, 'PENDING')], 'zzz', 'APPROVED', NOW)).toThrow(/not part/);
  });
});

describe('routeStep (segregation of duties)', () => {
  const step = { name: 'Manager approval', approverRole: 'MANAGER' as const };
  const sarah = { id: 'sarah', name: 'Sarah Collins' };
  const omar = { id: 'omar', name: 'Omar Khalil' };
  const admin = { id: 'alex', name: 'Alex Morgan', label: 'admin' };

  it('keeps normal routing when someone other than the requester can approve', () => {
    expect(routeStep(step, [sarah, omar], ['sarah'], [admin])).toBeNull();
  });

  it('routes away from a requester who is the only eligible approver', () => {
    expect(routeStep(step, [sarah], ['sarah'], [{ ...sarah, label: 'head of Sales' }, admin])).toEqual({
      assigneeId: 'alex',
      routingNote: 'Routed to Alex Morgan (admin) because the only eligible Manager is the requester.',
    });
  });

  it('routes to a fallback when nobody holds the role', () => {
    const route = routeStep(step, [], ['bob'], [{ ...omar, label: 'head of Procurement' }]);
    expect(route?.assigneeId).toBe('omar');
    expect(route?.routingNote).toContain('there is no active Manager');
  });

  it('fails when there is no one at all', () => {
    expect(() => routeStep(step, [sarah], ['sarah'], [])).toThrow(NoEligibleApproverError);
  });
});

describe('planEscalation', () => {
  const pending = { status: 'PENDING' as const, dueAt: hours(-1), escalationLevel: 0, slaHours: 24 };

  it('does nothing before the due date, or for steps without an SLA', () => {
    expect(planEscalation({ ...pending, dueAt: hours(1) }, NOW, true)).toBeNull();
    expect(planEscalation({ ...pending, dueAt: null }, NOW, true)).toBeNull();
    expect(planEscalation({ ...pending, status: 'APPROVED' }, NOW, true)).toBeNull();
  });

  it('goes to the department head first and re-arms the SLA', () => {
    expect(planEscalation(pending, NOW, true)).toEqual({ level: 1, nextDueAt: hours(24) });
  });

  it('goes to the admins next, or straight away when there is no head', () => {
    expect(planEscalation({ ...pending, escalationLevel: 1 }, NOW, true)).toEqual({ level: 2, nextDueAt: hours(-1) });
    expect(planEscalation(pending, NOW, false)?.level).toBe(2);
  });

  it('stops at the top level', () => {
    expect(planEscalation({ ...pending, escalationLevel: 2 }, NOW, true)).toBeNull();
  });
});
