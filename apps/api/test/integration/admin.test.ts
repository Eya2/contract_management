import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { clientFor, cookiePair, createDepartment, createUser, PASSWORD, type Client } from './helpers.js';

const app = createApp();
afterAll(() => prisma.$disconnect());

let admin: Client;
let adminId: string;
let deptId: string;

beforeAll(async () => {
  const user = await createUser('ADMIN');
  adminId = user.id;
  admin = await clientFor(app, user);
  deptId = (await createDepartment()).id;
});

const newUser = (overrides: Record<string, unknown> = {}) => ({
  email: `New.Person-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@Test.dev`,
  firstName: 'New',
  lastName: 'Person',
  role: 'EMPLOYEE',
  departmentId: deptId,
  password: 'Str0ng-enough-pw',
  ...overrides,
});

describe('user administration', () => {
  it('creates a user who can then sign in, and audits it', async () => {
    const body = newUser();
    const res = await admin.post('/api/users').send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.email).toBe(body.email.toLowerCase());
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const login = await request(app).post('/api/auth/login').send({ email: body.email, password: body.password });
    expect(login.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: res.body.id, action: 'USER_CREATED', userId: adminId } })).toBe(1);
  });

  it('rejects weak passwords and duplicate emails', async () => {
    expect((await admin.post('/api/users').send(newUser({ password: 'short1' }))).status).toBe(400);
    expect((await admin.post('/api/users').send(newUser({ password: 'onlyletterslong' }))).status).toBe(400);
    const body = newUser();
    await admin.post('/api/users').send(body);
    expect((await admin.post('/api/users').send(body)).status).toBe(409);
  });

  it('ends a user’s sessions when they are deactivated or their role changes', async () => {
    const user = await createUser('MANAGER', { departmentId: deptId });
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    const cookie = cookiePair(login);

    const res = await admin.patch(`/api/users/${user.id}`).send({ role: 'EMPLOYEE' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('EMPLOYEE');
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);

    await admin.patch(`/api/users/${user.id}`).send({ isActive: false });
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(401);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: 'USER_UPDATED' }, orderBy: { id: 'desc' } });
    expect(audit.metadata).toMatchObject({ changes: { isActive: { from: true, to: false } } });
  });

  it('resets a password', async () => {
    const user = await createUser('EMPLOYEE', { departmentId: deptId });
    expect((await admin.patch(`/api/users/${user.id}`).send({ password: 'Brand-new-pass-42' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'Brand-new-pass-42' })).status).toBe(200);
  });

  it('stops admins from locking themselves out', async () => {
    expect((await admin.patch(`/api/users/${adminId}`).send({ isActive: false })).status).toBe(400);
    expect((await admin.patch(`/api/users/${adminId}`).send({ role: 'LEGAL' })).status).toBe(400);
  });

  it('removes the headship of a head who changes department', async () => {
    const dept = await createDepartment();
    const head = await createUser('MANAGER', { departmentId: dept.id });
    expect((await admin.put(`/api/departments/${dept.id}/head`).send({ userId: head.id })).status).toBe(200);
    await admin.patch(`/api/users/${head.id}`).send({ departmentId: deptId });
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept.id } })).headId).toBeNull();
  });

  it('is admin-only', async () => {
    const manager = await clientFor(app, await createUser('MANAGER'));
    expect((await manager.post('/api/users').send(newUser())).status).toBe(403);
    expect((await manager.get('/api/departments/overview')).status).toBe(403);
  });
});

describe('departments', () => {
  it('creates a department and assigns a head from its members only', async () => {
    const code = `D${Date.now().toString().slice(-6)}`;
    const dept = await admin.post('/api/departments').send({ name: `Research ${code}`, code: code.toLowerCase() });
    expect(dept.status).toBe(201);
    expect(dept.body.code).toBe(code);

    const outsider = await createUser('MANAGER');
    expect((await admin.put(`/api/departments/${dept.body.id}/head`).send({ userId: outsider.id })).status).toBe(400);
    const member = await createUser('MANAGER', { departmentId: dept.body.id });
    expect((await admin.put(`/api/departments/${dept.body.id}/head`).send({ userId: member.id })).status).toBe(200);

    const overview = await admin.get('/api/departments/overview');
    const row = overview.body.find((d: { id: string }) => d.id === dept.body.id);
    expect(row).toMatchObject({ head: { id: member.id }, _count: { members: 1 } });
  });
});
