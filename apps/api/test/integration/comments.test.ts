import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { clientFor, createCounterparty, createDepartment, createUser, type Client } from './helpers.js';

const app = createApp();
afterAll(() => prisma.$disconnect());

type User = Awaited<ReturnType<typeof createUser>>;
let ownerUser: User, colleagueUser: User, outsiderUser: User;
let owner: Client, colleague: Client, outsider: Client, admin: Client;
let contractId: string;

beforeAll(async () => {
  const dept = await createDepartment();
  ownerUser = await createUser('EMPLOYEE', { departmentId: dept.id });
  colleagueUser = await createUser('EMPLOYEE', { departmentId: dept.id });
  outsiderUser = await createUser('EMPLOYEE');
  [owner, colleague, outsider, admin] = await Promise.all([
    clientFor(app, ownerUser),
    clientFor(app, colleagueUser),
    clientFor(app, outsiderUser),
    clientFor(app, await createUser('ADMIN')),
  ]);
  const res = await owner.post('/api/contracts').send({
    title: 'Comment test agreement',
    type: 'VENDOR',
    counterpartyId: (await createCounterparty()).id,
    value: 5000,
    currency: 'EUR',
    clauses: [
      { key: 'scope', heading: 'Scope', body: 'Managed hosting.' },
      { key: 'fees', heading: 'Fees', body: '5,000 EUR per year.' },
    ],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  contractId = res.body.id;
});

const notificationsOf = (userId: string) => prisma.notification.findMany({ where: { userId, contractId }, orderBy: { createdAt: 'asc' } });

describe('comments', () => {
  it('threads comments on a clause and tells the right people', async () => {
    const root = await colleague.post(`/api/contracts/${contractId}/comments`).send({ clauseKey: 'fees', body: 'Is this price per year or per month?' });
    expect(root.status, JSON.stringify(root.body)).toBe(201);

    // The owner hears about the new thread; the author doesn't.
    expect((await notificationsOf(ownerUser.id)).map((n) => n.type)).toEqual(['COMMENT_ADDED']);
    expect(await notificationsOf(colleagueUser.id)).toEqual([]);

    const reply = await owner.post(`/api/contracts/${contractId}/comments`).send({ parentId: root.body.id, body: 'Per year, I will make it clearer.' });
    expect(reply.status).toBe(201);
    expect((await notificationsOf(colleagueUser.id)).map((n) => n.type)).toEqual(['COMMENT_REPLY']);

    // A reply to a reply joins the same thread.
    const nested = await colleague.post(`/api/contracts/${contractId}/comments`).send({ parentId: reply.body.id, body: 'Thanks!' });
    expect(nested.status).toBe(201);

    const list = await owner.get(`/api/contracts/${contractId}/comments`).set('Accept-Language', 'fr');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ clause: { key: 'fees', heading: 'Fees' }, outdated: false, canResolve: true, versionNumber: 1 });
    expect(list.body[0].replies.map((r: { body: string }) => r.body)).toEqual(['Per year, I will make it clearer.', 'Thanks!']);

    // In French: the owner was told about the thread, then about the reply to their answer.
    const notif = await owner.get('/api/notifications?limit=5').set('Accept-Language', 'fr');
    const titles = notif.body.items.map((n: { title: string }) => n.title);
    expect(titles[0]).toMatch(/a répondu sur CTR-/);
    expect(titles[1]).toMatch(/a commenté « Fees » dans CTR-/);
  });

  it('notifies mentioned people only if they can see the contract', async () => {
    const res = await owner
      .post(`/api/contracts/${contractId}/comments`)
      .send({ body: '@Test EMPLOYEE can you check?', mentions: [colleagueUser.id, outsiderUser.id] });
    expect(res.status).toBe(201);
    expect((await notificationsOf(colleagueUser.id)).at(-1)?.type).toBe('COMMENT_MENTION');
    expect(await prisma.notification.count({ where: { userId: outsiderUser.id } })).toBe(0);

    const people = await owner.get(`/api/contracts/${contractId}/comment-participants`);
    const ids = people.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(colleagueUser.id);
    expect(ids).not.toContain(outsiderUser.id);
  });

  it('keeps comments private to people who can see the contract', async () => {
    expect((await outsider.get(`/api/contracts/${contractId}/comments`)).status).toBe(404);
    expect((await outsider.post(`/api/contracts/${contractId}/comments`).send({ body: 'hi' })).status).toBe(404);
    const [root] = (await owner.get(`/api/contracts/${contractId}/comments`)).body;
    expect((await outsider.post(`/api/comments/${root.id}/resolve`)).status).toBe(404);
  });

  it('lets the author edit, the author or an admin delete, and owners resolve', async () => {
    const created = await colleague.post(`/api/contracts/${contractId}/comments`).send({ clauseKey: 'scope', body: 'Typo in scope' });
    const id = created.body.id;

    expect((await owner.patch(`/api/comments/${id}`).send({ body: 'hijack' })).status).toBe(403);
    expect((await colleague.patch(`/api/comments/${id}`).send({ body: 'Typo in the scope clause' })).status).toBe(204);

    expect((await owner.post(`/api/comments/${id}/resolve`)).status).toBe(204);
    let thread = (await colleague.get(`/api/contracts/${contractId}/comments`)).body.find((c: { id: string }) => c.id === id);
    expect(thread).toMatchObject({ body: 'Typo in the scope clause', resolvedBy: { id: ownerUser.id } });
    expect(thread.editedAt).not.toBeNull();
    expect((await colleague.post(`/api/comments/${id}/reopen`)).status).toBe(204);

    expect((await owner.delete(`/api/comments/${id}`)).status).toBe(403);
    expect((await admin.delete(`/api/comments/${id}`)).status).toBe(204);
    thread = (await colleague.get(`/api/contracts/${contractId}/comments`)).body.find((c: { id: string }) => c.id === id);
    expect(thread).toMatchObject({ deleted: true, body: null, canEdit: false });
  });

  it('rejects unknown clauses and empty comments', async () => {
    expect((await owner.post(`/api/contracts/${contractId}/comments`).send({ clauseKey: 'nope', body: 'x' })).status).toBe(400);
    expect((await owner.post(`/api/contracts/${contractId}/comments`).send({ body: '   ' })).status).toBe(400);
  });

  it('flags a thread once its clause changes in a later version', async () => {
    const before = await owner.get(`/api/contracts/${contractId}`);
    const res = await owner.patch(`/api/contracts/${contractId}`).send({
      expectedVersion: before.body.currentVersionNumber,
      changeSummary: 'Clarify fees',
      clauses: [
        { key: 'scope', heading: 'Scope', body: 'Managed hosting.' },
        { key: 'fees', heading: 'Fees', body: '5,000 EUR per year, invoiced yearly.' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const threads = (await owner.get(`/api/contracts/${contractId}/comments`)).body;
    expect(threads.find((c: { clause: { key: string } | null }) => c.clause?.key === 'fees')).toMatchObject({ outdated: true, versionNumber: 1 });
  });
});
