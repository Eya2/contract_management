import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { jobQueue } from '../../src/jobs/job-queue.js';
import { prisma } from '../../src/lib/prisma.js';
import { signingService } from '../../src/modules/signing/signing.service.js';
import { clientFor, createCounterparty, createDepartment, createUser, type Client } from './helpers.js';

// Emails are captured instead of hitting SMTP.
const sent: { to: string; subject: string; text: string }[] = [];
vi.mock('../../src/lib/mailer.js', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; text: string }) => {
    if (m.to.startsWith('bounce')) throw new Error('SMTP 550 mailbox unavailable');
    sent.push(m);
  }),
}));

const app = createApp();
afterAll(() => prisma.$disconnect());

type User = Awaited<ReturnType<typeof createUser>>;
let deptId: string;
let counterpartyId: string;
let ownerUser: User, managerUser: User, legalUser: User;
let owner: Client, manager: Client, legal: Client, admin: Client;

// A tiny valid PNG (1x1), padded past the minimum size check.
const PNG =
  'data:image/png;base64,' +
  Buffer.concat([
    Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5b2d3b40000000049454e44ae426082', 'hex'),
    Buffer.alloc(64),
  ]).toString('base64');

beforeAll(async () => {
  deptId = (await createDepartment()).id;
  ownerUser = await createUser('EMPLOYEE', { departmentId: deptId });
  managerUser = await createUser('MANAGER', { departmentId: deptId });
  legalUser = await createUser('LEGAL');
  [owner, manager, legal, admin] = await Promise.all([
    clientFor(app, ownerUser),
    clientFor(app, managerUser),
    clientFor(app, legalUser),
    clientFor(app, await createUser('ADMIN')),
  ]);
  counterpartyId = (await createCounterparty()).id;
  await prisma.workflowTemplate.create({
    data: {
      name: `Signing test policy ${deptId.slice(0, 8)}`,
      contractType: 'CLIENT',
      departmentId: deptId,
      steps: { create: [{ stage: 1, name: 'Legal review', approverRole: 'LEGAL', approverScope: 'ANY' }] },
    },
  });
});

/** Creates a contract and takes it through approval. */
async function approvedContract(startDate?: string) {
  const created = await owner.post('/api/contracts').send({
    title: 'Consulting agreement',
    type: 'CLIENT',
    counterpartyId,
    value: 20000,
    startDate,
    clauses: [{ key: 'scope', heading: 'Scope', body: 'Consulting services.' }],
  });
  const id = created.body.id as string;
  const submitted = await owner.post(`/api/contracts/${id}/submit`).send({});
  const stepId = submitted.body[0].steps[0].id as string;
  expect((await legal.post(`/api/approvals/steps/${stepId}/approve`).send({})).status).toBe(200);
  return id;
}

async function externalToken(signerEmail: string): Promise<string> {
  const job = await prisma.job.findFirstOrThrow({
    where: { type: 'email.send', payload: { path: ['to'], equals: signerEmail } },
    orderBy: { createdAt: 'desc' },
  });
  return ((job.payload as Prisma.JsonObject).link as string).replace('/sign/', '');
}

describe('e-signature', () => {
  it('collects signatures in order, then activates the contract', async () => {
    const id = await approvedContract();
    const email = `client-${Date.now()}@example.com`;
    const set = await owner.put(`/api/contracts/${id}/signers`).send({
      signers: [
        { userId: managerUser.id, signingOrder: 1 },
        { name: 'Casey Client', email, signingOrder: 2 },
      ],
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const { contentHash } = set.body;
    expect(contentHash).toMatch(/^[0-9a-f]{64}$/);

    // The manager is up first and was notified; the external signer not yet.
    expect(await prisma.notification.count({ where: { userId: managerUser.id, contractId: id, type: 'SIGNATURE_REQUESTED' } })).toBe(1);
    expect(await prisma.job.count({ where: { payload: { path: ['to'], equals: email } } })).toBe(0);

    const signed = await manager.post(`/api/contracts/${id}/sign`).send({ contentHash, method: 'DRAWN', signatureImage: PNG, consent: true });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    const mine = signed.body.signers.find((s: { isMe: boolean }) => s.isMe);
    expect(mine).toMatchObject({ status: 'SIGNED', method: 'DRAWN', signedContentHash: contentHash });
    expect(mine.signatureFile.mimeType).toBe('image/png');

    // Now the external signer gets a link.
    const token = await externalToken(email);
    const view = await request(app).get(`/api/signing/${token}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ canSign: true, signer: { name: 'Casey Client' }, version: { contentHash } });

    const api = request(app);
    const done = await api.post(`/api/signing/${token}/sign`).send({ contentHash, method: 'TYPED', typedName: 'Casey Client', consent: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ canSign: false, signer: { status: 'SIGNED' }, contract: { status: 'ACTIVE' } });
    // The link still shows the confirmation but can't sign twice.
    const again = await api.post(`/api/signing/${token}/sign`).send({ contentHash, method: 'TYPED', typedName: 'Casey Client', consent: true });
    expect(again.status).toBe(409);
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(contract.status).toBe('ACTIVE');
    expect(contract.activatedAt).not.toBeNull();

    const evidence = await prisma.contractSigner.findFirstOrThrow({ where: { contractId: id, email } });
    expect(evidence).toMatchObject({ status: 'SIGNED', typedSignature: 'Casey Client', signedContentHash: contentHash });
    expect(evidence.ipAddress).toBeTruthy();
    expect(await prisma.notification.count({ where: { userId: ownerUser.id, contractId: id, type: 'CONTRACT_SIGNED' } })).toBe(1);
  });

  it('keeps a contract SIGNED until its start date, then the scheduler activates it', async () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const id = await approvedContract(future);
    const { body } = await owner.put(`/api/contracts/${id}/signers`).send({ signers: [{ userId: managerUser.id }] });
    await manager.post(`/api/contracts/${id}/sign`).send({ contentHash: body.contentHash, method: 'TYPED', typedName: 'Manager', consent: true });
    expect((await prisma.contract.findUniqueOrThrow({ where: { id } })).status).toBe('SIGNED');

    await signingService.activateDueContracts(new Date(Date.now() + 11 * 86_400_000));
    expect((await prisma.contract.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
  });

  it('refuses a signature on content the signer did not see, out of turn, or without consent', async () => {
    const id = await approvedContract();
    const { body } = await owner.put(`/api/contracts/${id}/signers`).send({
      signers: [{ userId: managerUser.id, signingOrder: 1 }, { userId: (await createUser('ADMIN')).id, signingOrder: 2 }],
    });
    const sign = (extra: Record<string, unknown>) =>
      manager.post(`/api/contracts/${id}/sign`).send({ contentHash: body.contentHash, method: 'TYPED', typedName: 'Manager', consent: true, ...extra });

    expect((await sign({ contentHash: 'f'.repeat(64) })).status).toBe(409);
    expect((await sign({ consent: false })).status).toBe(400);
    expect((await sign({ method: 'DRAWN', signatureImage: 'data:image/png;base64,AAAA' })).status).toBe(400);
    expect((await legal.post(`/api/contracts/${id}/sign`).send({ contentHash: body.contentHash, method: 'TYPED', typedName: 'Legal', consent: true })).status).toBe(403);
  });

  it('only allows signers whose role can sign, and only until the first signature', async () => {
    const id = await approvedContract();
    const bad = await owner.put(`/api/contracts/${id}/signers`).send({ signers: [{ userId: legalUser.id }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('not allowed to sign');

    const { body } = await owner.put(`/api/contracts/${id}/signers`).send({
      signers: [{ userId: managerUser.id }, { name: 'Late Signer', email: `late-${Date.now()}@example.com` }],
    });
    await manager.post(`/api/contracts/${id}/sign`).send({ contentHash: body.contentHash, method: 'TYPED', typedName: 'Manager', consent: true });
    expect((await owner.put(`/api/contracts/${id}/signers`).send({ signers: [{ userId: managerUser.id }] })).status).toBe(409);
    expect((await owner.post(`/api/contracts/${id}/reopen`).send({ reason: 'Change the fees' })).status).toBe(409);
  });

  it('sends the contract back to draft when a signer declines', async () => {
    const id = await approvedContract();
    const email = `decliner-${Date.now()}@example.com`;
    await owner.put(`/api/contracts/${id}/signers`).send({ signers: [{ name: 'Dee Cliner', email }] });
    const token = await externalToken(email);
    const api = request(app);
    const declined = await api.post(`/api/signing/${token}/decline`).send({ reason: 'Fees too high' });
    expect(declined.status).toBe(200);
    expect(declined.body).toMatchObject({ canSign: false, signer: { status: 'DECLINED' } });
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(contract.status).toBe('DRAFT');
    const change = await prisma.contractStatusChange.findFirstOrThrow({ where: { contractId: id, toStatus: 'DRAFT' }, orderBy: { createdAt: 'desc' } });
    expect(change.reason).toBe('Signature declined by Dee Cliner: Fees too high');
  });

  it('rejects unknown signing links', async () => {
    const api = request(app);
    expect((await api.get(`/api/signing/${'A'.repeat(43)}`)).status).toBe(404);
    expect((await api.get('/api/signing/short')).status).toBe(400);
  });
});

describe('notifications (the bell)', () => {
  it('lists, counts and marks a user’s own notifications as read', async () => {
    const user = await createUser('EMPLOYEE');
    const other = await createUser('EMPLOYEE');
    await prisma.notification.createMany({
      data: [1, 2, 3].map((n) => ({ userId: user.id, type: 'APPROVAL_GRANTED' as const, title: `N${n}`, body: 'b' })),
    });
    const [me, them] = await Promise.all([clientFor(app, user), clientFor(app, other)]);

    const list = await me.get('/api/notifications?limit=2');
    expect(list.body.unreadCount).toBe(3);
    expect(list.body.items).toHaveLength(2);

    const firstId = list.body.items[0].id;
    expect((await them.post(`/api/notifications/${firstId}/read`)).status).toBe(404);
    expect((await me.post(`/api/notifications/${firstId}/read`)).status).toBe(204);
    expect((await me.get('/api/notifications/unread-count')).body.unreadCount).toBe(2);
    expect((await me.post('/api/notifications/read-all')).body.marked).toBe(2);
    expect((await me.get('/api/notifications?unreadOnly=true')).body.items).toHaveLength(0);
  });
});

describe('email job worker', () => {
  it('delivers queued emails and retries failures with backoff', async () => {
    const ok = await prisma.job.create({
      data: { type: 'email.send', payload: { to: `ok-${Date.now()}@example.com`, subject: 'Hello', text: 'Body', link: '/contracts/x' }, runAt: new Date(0) },
    });
    const bounce = await prisma.job.create({
      data: { type: 'email.send', payload: { to: `bounce-${Date.now()}@example.com`, subject: 'Hi', text: 'Body' }, runAt: new Date(0), maxAttempts: 2 },
    });

    // Drain everything due (other test files queue emails too).
    while ((await jobQueue.runOnce(500)).completed + (await jobQueue.runOnce(500)).failed > 0) {
      /* keep draining */
    }
    const [okAfter, bounceAfter] = await Promise.all([
      prisma.job.findUniqueOrThrow({ where: { id: ok.id } }),
      prisma.job.findUniqueOrThrow({ where: { id: bounce.id } }),
    ]);
    expect(okAfter.status).toBe('COMPLETED');
    expect(sent.find((m) => m.subject === 'Hello')?.text).toContain('http://localhost:4200/contracts/x');
    expect(bounceAfter).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'SMTP 550 mailbox unavailable' });
    expect(bounceAfter.runAt.getTime()).toBeGreaterThan(Date.now());

    // Second failure reaches maxAttempts: the job is given up on.
    await prisma.job.update({ where: { id: bounce.id }, data: { runAt: new Date(0) } });
    await jobQueue.runOnce(200);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: bounce.id } })).status).toBe('FAILED');
  });
});

describe('audit log API', () => {
  it('is readable by Legal and Admin only, with string ids and cursor paging', async () => {
    const id = await approvedContract();
    expect((await owner.get(`/api/contracts/${id}/audit`)).status).toBe(403);
    const trail = await legal.get(`/api/contracts/${id}/audit?limit=2`);
    expect(trail.status).toBe(200);
    expect(trail.body.items).toHaveLength(2);
    expect(typeof trail.body.items[0].id).toBe('string');
    const next = await legal.get(`/api/contracts/${id}/audit?limit=50&before=${trail.body.nextCursor}`);
    const actions = [...trail.body.items, ...next.body.items].map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['CONTRACT_CREATED', 'CONTRACT_SUBMITTED', 'APPROVAL_STEP_APPROVED', 'CONTRACT_APPROVED']));

    const global = await admin.get(`/api/audit?contractId=${id}&action=CONTRACT_CREATED`);
    expect(global.body.items).toHaveLength(1);
    expect(global.body.items[0].user.id).toBe(ownerUser.id);
  });
});

describe('dashboard', () => {
  it('summarizes what the user can see and act on', async () => {
    const res = await owner.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ myDrafts: expect.any(Number), pendingMyApproval: 0, awaitingMySignature: 0 });
    expect(Array.isArray(res.body.recent)).toBe(true);
  });
});
