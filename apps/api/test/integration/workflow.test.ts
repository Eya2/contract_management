import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';
import { escalationService } from '../../src/modules/workflow/escalation.service.js';
import { clientFor, createCounterparty, createDepartment, createUser, type Client } from './helpers.js';

const app = createApp();
afterAll(() => prisma.$disconnect());

/**
 * One department ("Sales") with an employee, its manager and a director (the
 * department head), plus company-wide Legal and Finance reviewers. The policy
 * is scoped to VENDOR contracts of this department, so it is always the most
 * specific match, whatever other tests leave in the shared test database.
 *
 *   stage 1: Manager approval (manager of the contract's department, 24h SLA)
 *   stage 2: Legal review ∥ Finance review (only when value > 10,000)
 */
type User = Awaited<ReturnType<typeof createUser>>;
let deptId: string;
let counterpartyId: string;
let employeeUser: User, managerUser: User, directorUser: User, legalUser: User, financeUser: User, adminUser: User;
let employee: Client, manager: Client, director: Client, legal: Client, finance: Client, admin: Client, outsider: Client;

beforeAll(async () => {
  deptId = (await createDepartment()).id;
  employeeUser = await createUser('EMPLOYEE', { departmentId: deptId });
  managerUser = await createUser('MANAGER', { departmentId: deptId });
  directorUser = await createUser('MANAGER', { departmentId: deptId });
  await prisma.department.update({ where: { id: deptId }, data: { headId: directorUser.id } });
  legalUser = await createUser('LEGAL');
  financeUser = await createUser('FINANCE');
  adminUser = await createUser('ADMIN');
  [employee, manager, director, legal, finance, admin, outsider] = await Promise.all([
    clientFor(app, employeeUser),
    clientFor(app, managerUser),
    clientFor(app, directorUser),
    clientFor(app, legalUser),
    clientFor(app, financeUser),
    clientFor(app, adminUser),
    clientFor(app, await createUser('MANAGER')),
  ]);
  counterpartyId = (await createCounterparty()).id;

  await prisma.workflowTemplate.create({
    data: {
      name: `Sales vendor policy ${deptId.slice(0, 8)}`,
      contractType: 'VENDOR',
      departmentId: deptId,
      steps: {
        create: [
          { stage: 1, name: 'Manager approval', approverRole: 'MANAGER', approverScope: 'CONTRACT_DEPARTMENT', escalateAfterHours: 24 },
          { stage: 2, name: 'Legal review', approverRole: 'LEGAL', approverScope: 'ANY', escalateAfterHours: 48 },
          {
            stage: 2,
            name: 'Finance review',
            approverRole: 'FINANCE',
            approverScope: 'ANY',
            condition: { field: 'value', op: 'gt', value: 10000 } as Prisma.InputJsonValue,
            escalateAfterHours: 48,
          },
        ],
      },
    },
  });
});

interface Step {
  id: string;
  name: string;
  stage: number;
  status: string;
  skipReason: string | null;
  routingNote: string | null;
  canDecide: boolean;
  assignee: { id: string } | null;
  dueAt: string | null;
}

async function createDraft(client = employee, value = 45000) {
  const res = await client.post('/api/contracts').send({
    title: 'Hosting renewal',
    type: 'VENDOR',
    counterpartyId,
    value,
    clauses: [{ key: 'scope', heading: 'Scope', body: 'Managed hosting.' }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function submit(id: string, client = employee) {
  const res = await client.post(`/api/contracts/${id}/submit`).send({ comment: 'Please review' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body[0].steps as Step[];
}

async function steps(id: string, client: Client = employee): Promise<Step[]> {
  const res = await client.get(`/api/contracts/${id}/approvals`);
  return res.body[0].steps;
}

const step = (list: Step[], name: string) => list.find((s) => s.name === name)!;
const status = async (id: string) => (await employee.get(`/api/contracts/${id}`)).body.status as string;

describe('submission', () => {
  it('freezes the policy into steps, skips Finance below the threshold, and opens stage 1', async () => {
    const id = await createDraft(employee, 8000);
    const preview = await employee.get(`/api/contracts/${id}/approval-preview`);
    expect(preview.body.steps.map((s: { name: string; willRun: boolean }) => [s.name, s.willRun])).toEqual([
      ['Manager approval', true],
      ['Finance review', false],
      ['Legal review', true],
    ]);

    const list = await submit(id);
    expect(list.map((s) => [s.stage, s.name, s.status])).toEqual([
      [1, 'Manager approval', 'PENDING'],
      [2, 'Finance review', 'SKIPPED'],
      [2, 'Legal review', 'WAITING'],
    ]);
    expect(step(list, 'Finance review').skipReason).toBe('value 8,000.00 USD is not > 10,000');
    expect(step(list, 'Manager approval').dueAt).not.toBeNull();
    expect(await status(id)).toBe('SUBMITTED');

    // The approver was notified, in-app and by (queued) email.
    const note = await prisma.notification.findFirst({ where: { userId: managerUser.id, contractId: id, type: 'APPROVAL_REQUESTED' } });
    expect(note?.link).toBe(`/contracts/${id}?tab=approvals`);
    expect(await prisma.job.count({ where: { dedupeKey: `approval-requested:${step(list, 'Manager approval').id}:${managerUser.id}` } })).toBe(1);
  });

  it('binds the request to the exact version submitted, and locks editing', async () => {
    const id = await createDraft();
    await submit(id);
    const approvals = await employee.get(`/api/contracts/${id}/approvals`);
    expect(approvals.body[0].contractVersion.versionNumber).toBe(1);
    const edit = await employee.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, title: 'Sneaky change' });
    expect(edit.status).toBe(409);
  });

  it('refuses a second submission while one is in progress', async () => {
    const id = await createDraft();
    await submit(id);
    expect((await employee.post(`/api/contracts/${id}/submit`).send({})).status).toBe(409);
  });

  it('refuses to submit an empty contract', async () => {
    const res = await employee.post('/api/contracts').send({ title: 'Empty draft', type: 'VENDOR', counterpartyId });
    expect((await employee.post(`/api/contracts/${res.body.id}/submit`).send({})).status).toBe(400);
  });

  it('only lets the owner (or an admin) submit', async () => {
    const id = await createDraft();
    expect((await manager.post(`/api/contracts/${id}/submit`).send({})).status).toBe(403);
  });
});

describe('decisions', () => {
  it('walks a high-value contract through both stages, with parallel Legal and Finance', async () => {
    const id = await createDraft(employee, 45000);
    let list = await submit(id);

    expect((await manager.post(`/api/approvals/steps/${step(list, 'Manager approval').id}/approve`).send({ comment: 'OK' })).status).toBe(200);
    expect(await status(id)).toBe('UNDER_REVIEW');
    list = await steps(id);
    expect(step(list, 'Legal review').status).toBe('PENDING');
    expect(step(list, 'Finance review').status).toBe('PENDING');

    // Both parallel approvals land at the same moment: the contract lock makes
    // sure the stage still completes (neither sees the other as still pending).
    const [a, b] = await Promise.all([
      legal.post(`/api/approvals/steps/${step(list, 'Legal review').id}/approve`).send({}),
      finance.post(`/api/approvals/steps/${step(list, 'Finance review').id}/approve`).send({}),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await status(id)).toBe('APPROVED');

    const request = (await employee.get(`/api/contracts/${id}/approvals`)).body[0];
    expect(request.status).toBe('APPROVED');
    expect(request.completedAt).not.toBeNull();

    const timeline = (await employee.get(`/api/contracts/${id}/timeline`)).body.map((t: { toStatus: string }) => t.toStatus);
    expect(timeline).toEqual(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED']);
    expect(await prisma.notification.count({ where: { userId: employeeUser.id, contractId: id, type: 'CONTRACT_APPROVED' } })).toBe(1);
  });

  it('shows each approver their queue, and only what they can act on', async () => {
    const id = await createDraft();
    const list = await submit(id);
    const managerQueue = (await manager.get('/api/approvals/pending')).body as { id: string }[];
    expect(managerQueue.map((s) => s.id)).toContain(step(list, 'Manager approval').id);
    const legalQueue = (await legal.get('/api/approvals/pending')).body as { id: string }[];
    expect(legalQueue.map((s) => s.id)).not.toContain(step(list, 'Legal review').id); // still WAITING
    expect((await employee.get('/api/approvals/pending')).status).toBe(403);
  });

  it('refuses decisions out of turn, by the wrong person, or twice', async () => {
    const id = await createDraft();
    const list = await submit(id);
    const mgrStep = step(list, 'Manager approval').id;

    expect((await legal.post(`/api/approvals/steps/${step(list, 'Legal review').id}/approve`).send({})).status).toBe(409);
    expect((await legal.post(`/api/approvals/steps/${mgrStep}/approve`).send({})).status).toBe(403);
    expect((await outsider.post(`/api/approvals/steps/${mgrStep}/approve`).send({})).status).toBe(404);
    expect((await employee.post(`/api/approvals/steps/${mgrStep}/approve`).send({})).status).toBe(403);

    const results = await Promise.all([
      manager.post(`/api/approvals/steps/${mgrStep}/approve`).send({}),
      director.post(`/api/approvals/steps/${mgrStep}/approve`).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('ends the round on a rejection, which needs a reason; a revision starts a new round', async () => {
    const id = await createDraft();
    let list = await submit(id);
    await manager.post(`/api/approvals/steps/${step(list, 'Manager approval').id}/approve`).send({});
    list = await steps(id);

    const noReason = await finance.post(`/api/approvals/steps/${step(list, 'Finance review').id}/reject`).send({});
    expect(noReason.status).toBe(400);
    const rejected = await finance
      .post(`/api/approvals/steps/${step(list, 'Finance review').id}/reject`)
      .send({ comment: 'Budget not approved for 2027' });
    expect(rejected.status).toBe(200);

    list = await steps(id);
    expect(step(list, 'Legal review').status).toBe('CANCELLED');
    expect(await status(id)).toBe('REJECTED');
    const change = await prisma.contractStatusChange.findFirst({ where: { contractId: id, toStatus: 'REJECTED' } });
    expect(change?.reason).toBe('Finance review: Budget not approved for 2027');

    // The owner revises (new version, back to DRAFT) and resubmits: round 1 stays on record.
    const revised = await employee.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, value: 9000, changeSummary: 'Reduced scope' });
    expect(revised.status).toBe(200);
    expect(revised.body.status).toBe('DRAFT');
    await submit(id);
    const rounds = (await employee.get(`/api/contracts/${id}/approvals`)).body;
    expect(rounds.map((r: { status: string; contractVersion: { versionNumber: number } }) => [r.status, r.contractVersion.versionNumber])).toEqual([
      ['IN_PROGRESS', 2],
      ['REJECTED', 1],
    ]);
    expect(step(rounds[0].steps, 'Finance review').status).toBe('SKIPPED'); // 9,000 is under the threshold now
  });

  it('lets the owner withdraw, cancelling the open steps', async () => {
    const id = await createDraft();
    const list = await submit(id);
    expect((await legal.post(`/api/contracts/${id}/withdraw`).send({})).status).toBe(403);
    const res = await employee.post(`/api/contracts/${id}/withdraw`).send({ reason: 'Wrong counterparty' });
    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe('WITHDRAWN');
    expect(await status(id)).toBe('DRAFT');
    expect((await manager.post(`/api/approvals/steps/${step(list, 'Manager approval').id}/approve`).send({})).status).toBe(409);
  });

  it('reopens an approved contract as a draft that needs approval again', async () => {
    const id = await createDraft(employee, 5000);
    let list = await submit(id);
    await manager.post(`/api/approvals/steps/${step(list, 'Manager approval').id}/approve`).send({});
    list = await steps(id);
    await legal.post(`/api/approvals/steps/${step(list, 'Legal review').id}/approve`).send({});
    expect(await status(id)).toBe('APPROVED');

    expect((await employee.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, title: 'Changed' })).status).toBe(409);
    expect((await employee.post(`/api/contracts/${id}/reopen`).send({})).status).toBe(400);
    expect((await employee.post(`/api/contracts/${id}/reopen`).send({ reason: 'Counterparty asked for a new clause' })).status).toBe(204);
    expect(await status(id)).toBe('DRAFT');
  });
});

describe('segregation of duties', () => {
  it('routes the step away from a manager who submits their own contract', async () => {
    // A department where the manager is the only manager and also the head.
    const soloDept = await createDepartment();
    const soloManagerUser = await createUser('MANAGER', { departmentId: soloDept.id });
    await prisma.department.update({ where: { id: soloDept.id }, data: { headId: soloManagerUser.id } });
    await prisma.workflowTemplate.create({
      data: {
        name: `Solo policy ${soloDept.id.slice(0, 8)}`,
        contractType: 'VENDOR',
        departmentId: soloDept.id,
        steps: { create: [{ stage: 1, name: 'Manager approval', approverRole: 'MANAGER', approverScope: 'CONTRACT_DEPARTMENT' }] },
      },
    });
    const soloManager = await clientFor(app, soloManagerUser);

    const id = await createDraft(soloManager);
    const [mgrStep] = await submit(id, soloManager);
    expect(mgrStep!.routingNote).toMatch(/^Routed to .+ \(admin\) because the only eligible Manager is the requester\.$/);
    const assignee = await prisma.user.findUniqueOrThrow({ where: { id: mgrStep!.assignee!.id } });
    expect(assignee.role).toBe('ADMIN');
    expect(mgrStep!.canDecide).toBe(false);

    expect((await soloManager.post(`/api/approvals/steps/${mgrStep!.id}/approve`).send({})).status).toBe(403);
    expect((await soloManager.get('/api/approvals/pending')).body.map((s: { id: string }) => s.id)).not.toContain(mgrStep!.id);
  });

  it('keeps normal routing when another eligible approver exists', async () => {
    const id = await createDraft(manager);
    const [mgrStep] = await submit(id, manager);
    expect(mgrStep!.assignee).toBeNull();
    expect((await manager.post(`/api/approvals/steps/${mgrStep!.id}/approve`).send({})).status).toBe(403);
    expect((await director.post(`/api/approvals/steps/${mgrStep!.id}/approve`).send({})).status).toBe(200);
  });
});

describe('escalation', () => {
  async function makeOverdue(stepId: string) {
    await prisma.approvalStep.update({ where: { id: stepId }, data: { dueAt: new Date(Date.now() - 60_000) } });
  }

  it('escalates to the department head, then to the admins, exactly once per level', async () => {
    const id = await createDraft();
    const [mgrStep] = await submit(id);
    await makeOverdue(mgrStep!.id);

    // Two scanners running at once (e.g. two API instances) must not double-escalate.
    await Promise.all([escalationService.runOnce(), escalationService.runOnce()]);
    let escalations = await prisma.approvalEscalation.findMany({ where: { stepId: mgrStep!.id } });
    expect(escalations.map((e) => [e.level, e.escalatedToId])).toEqual([[1, directorUser.id]]);
    const afterLevel1 = await prisma.approvalStep.findUniqueOrThrow({ where: { id: mgrStep!.id } });
    expect(afterLevel1.escalationLevel).toBe(1);
    expect(afterLevel1.dueAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000); // SLA re-armed

    // Not overdue any more: nothing happens.
    await escalationService.runOnce();
    expect(await prisma.approvalEscalation.count({ where: { stepId: mgrStep!.id } })).toBe(1);

    await makeOverdue(mgrStep!.id);
    await escalationService.runOnce();
    escalations = await prisma.approvalEscalation.findMany({ where: { stepId: mgrStep!.id, level: 2 } });
    expect(escalations.map((e) => e.escalatedToId)).toContain(adminUser.id);
    expect(await prisma.notification.count({ where: { userId: adminUser.id, contractId: id, type: 'APPROVAL_ESCALATED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { contractId: id, action: 'APPROVAL_ESCALATED' } })).toBe(2);

    // Top level reached: further scans leave it alone.
    await makeOverdue(mgrStep!.id);
    await escalationService.runOnce();
    expect((await prisma.approvalStep.findUniqueOrThrow({ where: { id: mgrStep!.id } })).escalationLevel).toBe(2);
  });

  it('lets the person a step was escalated to decide it', async () => {
    const id = await createDraft(employee, 5000);
    const [mgrStep] = await submit(id);
    // Before escalation, an admin holds no approval rights on a Manager step.
    expect((await admin.post(`/api/approvals/steps/${mgrStep!.id}/approve`).send({})).status).toBe(403);

    await prisma.approvalStep.update({ where: { id: mgrStep!.id }, data: { escalationLevel: 1 } });
    await makeOverdue(mgrStep!.id);
    await escalationService.runOnce();

    const queue = (await admin.get('/api/approvals/pending')).body as { id: string; escalatedToMe: boolean; overdue: boolean }[];
    expect(queue.find((s) => s.id === mgrStep!.id)).toMatchObject({ escalatedToMe: true, overdue: true });
    expect((await admin.post(`/api/approvals/steps/${mgrStep!.id}/approve`).send({})).status).toBe(200);
  });
});

describe('workflow templates API', () => {
  const policy = (departmentId: string, overrides: Record<string, unknown> = {}) => ({
    name: 'Client contracts',
    contractType: 'CLIENT',
    departmentId,
    steps: [
      { stage: 1, name: 'Legal review', approverRole: 'LEGAL', escalateAfterHours: 24 },
      { stage: 2, name: 'Finance review', approverRole: 'FINANCE', condition: { field: 'value', op: 'gte', value: 50000 } },
    ],
    ...overrides,
  });

  it('lets admins create and update policies, with readable conditions', async () => {
    const dept = await createDepartment();
    const created = await admin.post('/api/workflow-templates').send(policy(dept.id));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.steps[1].conditionText).toBe('value ≥ 50,000');

    const updated = await admin.put(`/api/workflow-templates/${created.body.id}`).send(
      policy(dept.id, { steps: [{ stage: 1, name: 'Legal review', approverRole: 'LEGAL' }] }),
    );
    expect(updated.status).toBe(200);
    expect(updated.body.steps).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: created.body.id, action: 'WORKFLOW_TEMPLATE_UPDATED' } })).toBe(2);
  });

  it('refuses a second active policy with the same scope', async () => {
    const dept = await createDepartment();
    expect((await admin.post('/api/workflow-templates').send(policy(dept.id))).status).toBe(201);
    expect((await admin.post('/api/workflow-templates').send(policy(dept.id, { name: 'Duplicate' }))).status).toBe(409);
    expect((await admin.post('/api/workflow-templates').send(policy(dept.id, { name: 'Inactive copy', isActive: false }))).status).toBe(201);
  });

  it('validates steps and conditions', async () => {
    const dept = await createDepartment();
    const bad = [
      policy(dept.id, { steps: [] }),
      policy(dept.id, { steps: [{ stage: 1, name: 'Peer review', approverRole: 'EMPLOYEE' }] }),
      policy(dept.id, { steps: [{ stage: 1, name: 'Finance', approverRole: 'FINANCE', condition: { field: 'value', op: 'gt', value: 'lots' } }] }),
    ];
    for (const body of bad) expect((await admin.post('/api/workflow-templates').send(body)).status).toBe(400);
  });

  it('is admin-only for writes', async () => {
    const dept = await createDepartment();
    expect((await manager.post('/api/workflow-templates').send(policy(dept.id))).status).toBe(403);
    expect((await manager.get('/api/workflow-templates')).status).toBe(200);
  });

  it('never changes a request already in flight', async () => {
    const id = await createDraft();
    await submit(id);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { departmentId: deptId, contractType: 'VENDOR' } });
    const before = await steps(id);
    await admin.put(`/api/workflow-templates/${template.id}`).send({
      name: template.name,
      contractType: 'VENDOR',
      departmentId: deptId,
      steps: [
        { stage: 1, name: 'Manager approval', approverRole: 'MANAGER', approverScope: 'CONTRACT_DEPARTMENT', escalateAfterHours: 24 },
        { stage: 2, name: 'Legal review', approverRole: 'LEGAL', escalateAfterHours: 48 },
        { stage: 2, name: 'Finance review', approverRole: 'FINANCE', condition: { field: 'value', op: 'gt', value: 10000 }, escalateAfterHours: 48 },
      ],
    });
    const after = await steps(id);
    expect(after.map((s) => [s.name, s.status])).toEqual(before.map((s) => [s.name, s.status]));
  });
});

describe('auto-approval', () => {
  it('approves at once when every step is skipped', async () => {
    const dept = await createDepartment();
    const owner = await createUser('EMPLOYEE', { departmentId: dept.id });
    await prisma.workflowTemplate.create({
      data: {
        name: `Big-ticket only ${dept.id.slice(0, 8)}`,
        contractType: 'VENDOR',
        departmentId: dept.id,
        steps: {
          create: [{ stage: 1, name: 'Finance review', approverRole: 'FINANCE', condition: { field: 'value', op: 'gt', value: 1_000_000 } }],
        },
      },
    });
    const client = await clientFor(app, owner);
    const id = await createDraft(client, 500);
    const [only] = await submit(id, client);
    expect(only!.status).toBe('SKIPPED');
    expect((await client.get(`/api/contracts/${id}`)).body.status).toBe('APPROVED');
  });
});
