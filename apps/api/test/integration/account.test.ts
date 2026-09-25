import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';
import { clientFor, cookiePair, createCounterparty, createDepartment, createUser, PASSWORD } from './helpers.js';

const app = createApp();
afterAll(() => prisma.$disconnect());

const login = (email: string, password = PASSWORD) => request(app).post('/api/auth/login').send({ email, password });

async function resetLinkFor(email: string): Promise<string> {
  const job = await prisma.job.findFirstOrThrow({
    where: { payload: { path: ['to'], equals: email }, AND: { payload: { path: ['subject'], string_contains: 'Reset' } } },
    orderBy: { createdAt: 'desc' },
  });
  return ((job.payload as Prisma.JsonObject).link as string).split('token=')[1]!;
}

describe('forgot password', () => {
  it('emails a one-time link that resets the password and ends every session', async () => {
    const user = await createUser('EMPLOYEE');
    const session = cookiePair(await login(user.email));

    const res = await request(app).post('/api/auth/forgot-password').send({ email: user.email.toUpperCase() });
    expect(res.status).toBe(202);
    const token = await resetLinkFor(user.email);
    expect((await request(app).get(`/api/auth/reset-password/${token}`)).body).toEqual({ valid: true });

    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'A-brand-new-pass-1' })).status).toBe(204);

    expect((await login(user.email)).status).toBe(401);
    expect((await login(user.email, 'A-brand-new-pass-1')).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', session)).status).toBe(401);

    // Single use.
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'Another-pass-22' })).status).toBe(400);
    expect((await request(app).get(`/api/auth/reset-password/${token}`)).body).toEqual({ valid: false });
  });

  it('answers the same for unknown emails and sends nothing', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody-here@test.dev' });
    expect(res.status).toBe(202);
    expect(await prisma.job.count({ where: { payload: { path: ['to'], equals: 'nobody-here@test.dev' } } })).toBe(0);
  });

  it('invalidates an older link when a new one is requested, and expired links', async () => {
    const user = await createUser('EMPLOYEE');
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const first = await resetLinkFor(user.email);
    await new Promise((r) => setTimeout(r, 5));
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    const second = await resetLinkFor(user.email);
    expect(second).not.toBe(first);
    expect((await request(app).post('/api/auth/reset-password').send({ token: first, password: 'Brand-new-pass-9' })).status).toBe(400);

    await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/api/auth/reset-password').send({ token: second, password: 'Brand-new-pass-9' })).status).toBe(400);
  });
});

describe('change password and profile', () => {
  it('requires the current password and keeps only the current session', async () => {
    const user = await createUser('LEGAL');
    const other = cookiePair(await login(user.email));
    const mine = await login(user.email);
    const auth = { Authorization: `Bearer ${mine.body.accessToken}`, Cookie: cookiePair(mine) };

    const wrong = await request(app).post('/api/auth/change-password').set(auth).send({ currentPassword: 'nope', newPassword: 'Changed-pass-123' });
    expect(wrong.status).toBe(400); // not 401: the web app would treat that as a dead session
    expect((await request(app).post('/api/auth/change-password').set(auth).send({ currentPassword: PASSWORD, newPassword: 'Changed-pass-123' })).status).toBe(204);

    expect((await request(app).post('/api/auth/refresh').set('Cookie', other)).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookiePair(mine))).status).toBe(200);
    expect((await login(user.email, 'Changed-pass-123')).status).toBe(200);
  });

  it('updates the name', async () => {
    const client = await clientFor(app, await createUser('EMPLOYEE'));
    const res = await client.patch('/api/auth/me').send({ firstName: 'Renamed' });
    expect(res.body.firstName).toBe('Renamed');
  });
});

describe('termination and export', () => {
  it('lets a manager of the department terminate an active contract, with a reason', async () => {
    const dept = await createDepartment();
    const owner = await clientFor(app, await createUser('EMPLOYEE', { departmentId: dept.id }));
    const manager = await clientFor(app, await createUser('MANAGER', { departmentId: dept.id }));
    const otherManager = await clientFor(app, await createUser('MANAGER'));
    const counterpartyId = (await createCounterparty()).id;
    const created = await owner.post('/api/contracts').send({ title: 'Cleaning services', type: 'VENDOR', counterpartyId });
    const id = created.body.id as string;

    expect((await manager.post(`/api/contracts/${id}/terminate`).send({ reason: 'Not signed' })).status).toBe(409);
    await prisma.contract.update({ where: { id }, data: { status: 'ACTIVE' } });
    expect((await owner.post(`/api/contracts/${id}/terminate`).send({ reason: 'Nope' })).status).toBe(403); // employees lack the permission
    expect((await otherManager.post(`/api/contracts/${id}/terminate`).send({ reason: 'Nope' })).status).toBe(404); // can't even see it

    const res = await manager.post(`/api/contracts/${id}/terminate`).send({ reason: 'Supplier closed its business' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'TERMINATED', terminationReason: 'Supplier closed its business' });
  });

  it('exports the visible contracts as CSV, neutralising formulas', async () => {
    const client = await clientFor(app, await createUser('EMPLOYEE'));
    const counterpartyId = (await createCounterparty()).id;
    await client.post('/api/contracts').send({ title: '=HYPERLINK("http://evil")', type: 'NDA', counterpartyId });
    const res = await client.get('/api/contracts/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('"Reference","Title"');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});
