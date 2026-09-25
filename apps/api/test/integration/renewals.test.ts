import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { renewalService } from '../../src/modules/renewals/renewal.service.js';
import { clientFor, createCounterparty, createDepartment, createUser, type Client } from './helpers.js';

const app = createApp();
afterAll(() => prisma.$disconnect());

type User = Awaited<ReturnType<typeof createUser>>;
let owner: Client, colleague: Client;
let ownerUser: User, headUser: User;
let counterpartyId: string;

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const NOW = new Date('2027-06-15T09:00:00Z');

beforeAll(async () => {
  const dept = await createDepartment();
  ownerUser = await createUser('EMPLOYEE', { departmentId: dept.id });
  headUser = await createUser('MANAGER', { departmentId: dept.id });
  await prisma.department.update({ where: { id: dept.id }, data: { headId: headUser.id } });
  owner = await clientFor(app, ownerUser);
  colleague = await clientFor(app, await createUser('EMPLOYEE', { departmentId: dept.id }));
  counterpartyId = (await createCounterparty()).id;
});

/** A contract created through the API, then put in force directly (approval and signing are tested elsewhere). */
async function activeContract(opts: { start: string; end: string; autoRenew?: boolean }) {
  const res = await owner.post('/api/contracts').send({
    title: 'Support retainer',
    type: 'CLIENT',
    counterpartyId,
    value: 12000,
    startDate: opts.start,
    endDate: opts.end,
    autoRenew: opts.autoRenew ?? false,
    clauses: [{ key: 'scope', heading: 'Scope', body: 'Monthly support.' }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await prisma.contract.update({ where: { id: res.body.id }, data: { status: 'ACTIVE', activatedAt: day(opts.start) } });
  return res.body.id as string;
}

const status = async (id: string) => (await prisma.contract.findUniqueOrThrow({ where: { id } })).status;

describe('expiry reminders', () => {
  it('notifies the owner and department head at 30, 7 and 1 days, exactly once each', async () => {
    const id = await activeContract({ start: '2026-07-16', end: '2027-07-15' }); // 30 days after NOW

    await renewalService.runOnce(NOW);
    await renewalService.runOnce(NOW); // same day again: nothing new
    const at30 = await prisma.notification.findMany({ where: { contractId: id, type: 'CONTRACT_EXPIRING' } });
    expect(at30.map((n) => n.userId).sort()).toEqual([ownerUser.id, headUser.id].sort());
    expect(at30[0]!.title).toContain('ends in 30 days');

    await renewalService.runOnce(new Date('2027-07-10T09:00:00Z')); // 5 days left → the 7-day reminder
    await renewalService.runOnce(new Date('2027-07-15T09:00:00Z')); // last day → the 1-day reminder
    await renewalService.runOnce(new Date('2027-07-15T18:00:00Z'));
    const all = await prisma.notification.findMany({ where: { contractId: id, userId: ownerUser.id }, orderBy: { createdAt: 'asc' } });
    expect(all.map((n) => n.title.replace(/^.* (ends)/, '$1'))).toEqual(['ends in 30 days', 'ends in 5 days', 'ends today']);
    // Emails are queued once per reminder too.
    expect(await prisma.job.count({ where: { dedupeKey: { startsWith: `expiry:${id}:` } } })).toBe(6);
  });

  it('does not remind about a contract that is already renewed', async () => {
    const id = await activeContract({ start: '2026-07-10', end: '2027-07-09' });
    await prisma.contract.create({
      data: {
        title: 'Renewal', type: 'CLIENT', counterpartyId, ownerId: ownerUser.id, departmentId: (await prisma.contract.findUniqueOrThrow({ where: { id } })).departmentId,
        status: 'SIGNED', renewalOfId: id,
      },
    });
    await renewalService.runOnce(NOW);
    expect(await prisma.notification.count({ where: { contractId: id } })).toBe(0);
  });
});

describe('end of term', () => {
  it('expires a contract without auto-renewal', async () => {
    const id = await activeContract({ start: '2026-06-01', end: '2027-06-14' });
    const res = await renewalService.runOnce(NOW);
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toBe('EXPIRED');
    const n = await prisma.notification.findFirstOrThrow({ where: { contractId: id, userId: ownerUser.id, title: { contains: 'has expired' } } });
    expect(n.body).toContain('You can still start one');
  });

  it('renews automatically on the same terms, for the next term', async () => {
    const id = await activeContract({ start: '2026-06-15', end: '2027-06-14', autoRenew: true });
    await renewalService.runOnce(NOW);
    await renewalService.runOnce(NOW); // idempotent: still one successor

    expect(await status(id)).toBe('RENEWED');
    const successors = await prisma.contract.findMany({ where: { renewalOfId: id }, include: { versions: { include: { clauses: true } } } });
    expect(successors).toHaveLength(1);
    const next = successors[0]!;
    expect(next).toMatchObject({ status: 'ACTIVE', autoRenew: true, ownerId: ownerUser.id });
    expect(next.startDate?.toISOString().slice(0, 10)).toBe('2027-06-15');
    expect(next.endDate?.toISOString().slice(0, 10)).toBe('2028-06-14');
    expect(next.versions[0]!.clauses.map((c) => c.body)).toEqual(['Monthly support.']);

    const detail = await owner.get(`/api/contracts/${next.id}`);
    expect(detail.body.renewalOf).toMatchObject({ id, status: 'RENEWED' });
    const timeline = await owner.get(`/api/contracts/${id}/timeline`);
    expect(timeline.body.at(-1)).toMatchObject({ toStatus: 'RENEWED', actor: null });
  });

  it('marks a contract RENEWED when its renewal is already signed', async () => {
    const id = await activeContract({ start: '2026-06-01', end: '2027-06-10', autoRenew: true });
    const renewal = await owner.post(`/api/contracts/${id}/renew`).send({});
    await prisma.contract.update({ where: { id: renewal.body.id }, data: { status: 'SIGNED' } });

    await renewalService.runOnce(NOW);
    expect(await status(id)).toBe('RENEWED');
    // The manual renewal took precedence: no automatic successor was created.
    expect(await prisma.contract.count({ where: { renewalOfId: id } })).toBe(1);
  });
});

describe('manual renewal', () => {
  it('creates a draft for the next term, linked to the original', async () => {
    const id = await activeContract({ start: '2027-01-01', end: '2027-12-31' });
    expect((await colleague.post(`/api/contracts/${id}/renew`).send({})).status).toBe(403);

    const res = await owner.post(`/api/contracts/${id}/renew`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', startDate: '2028-01-01T00:00:00.000Z', endDate: '2028-12-31T00:00:00.000Z' });
    expect(res.body.renewalOf).toMatchObject({ id });
    expect(res.body.currentVersion.changeSummary).toMatch(/^Renewal of CTR-/);

    const original = await owner.get(`/api/contracts/${id}`);
    expect(original.body.renewedBy).toMatchObject({ id: res.body.id, status: 'DRAFT' });
    expect((await owner.post(`/api/contracts/${id}/renew`).send({})).status).toBe(409);
  });

  it('refuses to renew a contract that is not in force', async () => {
    const draft = await owner.post('/api/contracts').send({ title: 'Just a draft', type: 'NDA', counterpartyId });
    expect((await owner.post(`/api/contracts/${draft.body.id}/renew`).send({})).status).toBe(409);
  });
});
