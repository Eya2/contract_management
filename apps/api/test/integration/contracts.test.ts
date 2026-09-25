import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { sha256Hex } from '../../src/lib/storage.js';
import { clientFor, createCounterparty, createDepartment, createUser, type Client } from './helpers.js';

const app = createApp();
afterAll(() => prisma.$disconnect());

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

let owner: Client;
let colleague: Client; // same department, not the owner
let outsider: Client; // another department
let admin: Client;
let counterpartyId: string;
let departmentId: string;

beforeAll(async () => {
  const dept = await createDepartment();
  departmentId = dept.id;
  owner = await clientFor(app, await createUser('EMPLOYEE', { departmentId }));
  colleague = await clientFor(app, await createUser('EMPLOYEE', { departmentId }));
  outsider = await clientFor(app, await createUser('MANAGER'));
  admin = await clientFor(app, await createUser('ADMIN'));
  counterpartyId = (await createCounterparty()).id;
});

function draft(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Hosting agreement',
    type: 'VENDOR',
    counterpartyId,
    value: 12000,
    currency: 'usd',
    startDate: '2027-01-01',
    endDate: '2027-12-31',
    clauses: [
      { key: 'scope', heading: 'Scope', body: 'Managed hosting.' },
      { key: 'fees', heading: 'Fees', body: '12,000 USD per year.' },
    ],
    ...overrides,
  };
}

async function createContract(client = owner, overrides: Record<string, unknown> = {}) {
  const res = await client.post('/api/contracts').send(draft(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; currentVersionNumber: number; referenceNumber: string };
}

describe('creating contracts', () => {
  it('creates a draft with version 1, a reference number, a timeline entry and an audit record', async () => {
    const res = await owner.post('/api/contracts').send(draft());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      currentVersionNumber: 1,
      currency: 'USD',
      value: '12000',
      department: { id: departmentId },
      currentVersion: { versionNumber: 1, changeSummary: 'Initial draft' },
    });
    expect(res.body.referenceNumber).toMatch(/^CTR-\d{4}-\d{5}$/);
    expect(res.body.currentVersion.clauses.map((c: { key: string }) => c.key)).toEqual(['scope', 'fees']);
    expect(res.body.currentVersion.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const timeline = await owner.get(`/api/contracts/${res.body.id}/timeline`);
    expect(timeline.body).toMatchObject([{ fromStatus: null, toStatus: 'DRAFT' }]);
    const audit = await prisma.auditLog.findFirst({ where: { contractId: res.body.id, action: 'CONTRACT_CREATED' } });
    expect(audit).not.toBeNull();
  });

  it('validates input', async () => {
    const bad = await owner.post('/api/contracts').send(draft({ value: -5, endDate: '2026-01-01', title: '' }));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details.fieldErrors)).toEqual(expect.arrayContaining(['value', 'title']));

    const dupKeys = await owner.post('/api/contracts').send(draft({ clauses: [{ key: 'a', heading: 'A', body: 'x' }, { key: 'a', heading: 'B', body: 'y' }] }));
    expect(dupKeys.status).toBe(400);

    const unknownParty = await owner.post('/api/contracts').send(draft({ counterpartyId: '00000000-0000-4000-8000-000000000000' }));
    expect(unknownParty.status).toBe(400);
  });

  it('keeps non-admins in their own department', async () => {
    const other = await createDepartment();
    expect((await owner.post('/api/contracts').send(draft({ departmentId: other.id }))).status).toBe(403);
    const res = await admin.post('/api/contracts').send(draft({ departmentId: other.id }));
    expect(res.status).toBe(201);
    expect(res.body.department.id).toBe(other.id);
  });

  it('forbids Finance from creating contracts', async () => {
    const finance = await clientFor(app, await createUser('FINANCE'));
    expect((await finance.post('/api/contracts').send(draft())).status).toBe(403);
  });
});

describe('documents', () => {
  it('stores an uploaded document, hashes it, and serves it back with an audit record', async () => {
    const res = await owner
      .post('/api/contracts')
      .field('data', JSON.stringify(draft()))
      .attach('document', PDF, { filename: 'hosting.pdf', contentType: 'application/pdf' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.currentVersion.file).toMatchObject({ originalName: 'hosting.pdf', mimeType: 'application/pdf', sha256: sha256Hex(PDF) });

    const download = await colleague.get(`/api/contracts/${res.body.id}/versions/1/document`).buffer(true);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toContain('hosting.pdf');
    expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);

    const audit = await prisma.auditLog.findFirst({ where: { contractId: res.body.id, action: 'DOCUMENT_DOWNLOADED' } });
    expect(audit).not.toBeNull();
  });

  it('rejects disallowed or disguised files', async () => {
    const exe = await owner
      .post('/api/contracts')
      .field('data', JSON.stringify(draft()))
      .attach('document', Buffer.from('MZ\x90\x00'), { filename: 'contract.exe' });
    expect(exe.status).toBe(400);
    expect(exe.body.error.message).toContain('Unsupported file type');

    const fakePdf = await owner
      .post('/api/contracts')
      .field('data', JSON.stringify(draft()))
      .attach('document', Buffer.from('<html>not a pdf</html>'), { filename: 'contract.pdf' });
    expect(fakePdf.status).toBe(400);
    expect(fakePdf.body.error.message).toContain('not a valid .pdf');
  });

  it('returns 404 for a version without a document', async () => {
    const { id } = await createContract();
    expect((await owner.get(`/api/contracts/${id}/versions/1/document`)).status).toBe(404);
  });
});

describe('editing and version history', () => {
  it('appends a version, keeps the old one intact, and diffs them', async () => {
    const { id } = await createContract();
    const res = await owner.patch(`/api/contracts/${id}`).send({
      expectedVersion: 1,
      value: 15000,
      changeSummary: 'Price increase',
      clauses: [
        { key: 'scope', heading: 'Scope', body: 'Managed hosting.' },
        { key: 'fees', heading: 'Fees', body: '15,000 USD per year.' },
        { key: 'sla', heading: 'Service levels', body: '99.9% uptime.' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ currentVersionNumber: 2, value: '15000' });

    const versions = await owner.get(`/api/contracts/${id}/versions`);
    expect(versions.body.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
    expect(versions.body[0].contentHash).not.toBe(versions.body[1].contentHash);

    const v1 = await owner.get(`/api/contracts/${id}/versions/1`);
    expect(v1.body.value).toBe('12000');
    expect(v1.body.clauses).toHaveLength(2);

    const diff = await owner.get(`/api/contracts/${id}/versions/diff?from=1&to=2`);
    expect(diff.body.fields).toEqual([{ field: 'value', from: '12000.00', to: '15000.00' }]);
    expect(diff.body.clauses.added.map((c: { key: string }) => c.key)).toEqual(['sla']);
    expect(diff.body.clauses.changed.map((c: { key: string }) => c.key)).toEqual(['fees']);
  });

  it('refuses a save based on an outdated version (optimistic concurrency)', async () => {
    const { id } = await createContract();
    expect((await owner.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, title: 'Edit A' })).status).toBe(200);
    const stale = await owner.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, title: 'Edit B' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toEqual({ currentVersion: 2 });
  });

  it('lets exactly one of two simultaneous edits win', async () => {
    const { id } = await createContract();
    const results = await Promise.all(
      ['A', 'B', 'C'].map((t) => owner.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, title: `Concurrent ${t}` })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await prisma.contractVersion.count({ where: { contractId: id } })).toBe(2);
  });

  it('refuses an edit that changes nothing', async () => {
    const { id } = await createContract();
    const res = await owner.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, title: 'Hosting agreement' });
    expect(res.status).toBe(400);
  });

  it('changes auto-renew without creating a version (it is not part of the signed content)', async () => {
    const { id } = await createContract();
    const res = await owner.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, autoRenew: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ autoRenew: true, currentVersionNumber: 1 });
  });

  it('replaces and removes the document through new versions', async () => {
    const { id } = await createContract();
    const withDoc = await owner
      .patch(`/api/contracts/${id}`)
      .field('data', JSON.stringify({ expectedVersion: 1, changeSummary: 'Signed-off PDF' }))
      .attach('document', PDF, { filename: 'v2.pdf' });
    expect(withDoc.status, JSON.stringify(withDoc.body)).toBe(200);
    expect(withDoc.body.currentVersion.file.originalName).toBe('v2.pdf');

    const removed = await owner.patch(`/api/contracts/${id}`).send({ expectedVersion: 2, removeDocument: true });
    expect(removed.status).toBe(200);
    expect(removed.body.currentVersion.file).toBeNull();
    expect((await owner.get(`/api/contracts/${id}/versions/2/document`)).status).toBe(200);
  });

  it('only lets the owner or an admin edit', async () => {
    const { id } = await createContract();
    expect((await colleague.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, title: 'Hijack' })).status).toBe(403);
    expect((await admin.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, title: 'Admin fix' })).status).toBe(200);
  });
});

describe('visibility', () => {
  it('shows department contracts to colleagues and hides them from other departments (404, not 403)', async () => {
    const { id, referenceNumber } = await createContract();
    expect((await colleague.get(`/api/contracts/${id}`)).status).toBe(200);
    expect((await outsider.get(`/api/contracts/${id}`)).status).toBe(404);
    expect((await outsider.get(`/api/contracts/${id}/versions`)).status).toBe(404);
    expect((await outsider.patch(`/api/contracts/${id}`).send({ expectedVersion: 1, title: 'Hijack' })).status).toBe(404);

    const list = await outsider.get(`/api/contracts?q=${referenceNumber}`);
    expect(list.body.total).toBe(0);
    const adminList = await admin.get(`/api/contracts?q=${referenceNumber}`);
    expect(adminList.body.total).toBe(1);
  });

  it('audits who viewed a contract', async () => {
    const { id } = await createContract();
    await colleague.get(`/api/contracts/${id}`);
    expect(await prisma.auditLog.count({ where: { contractId: id, action: 'CONTRACT_VIEWED' } })).toBe(1);
  });
});

describe('listing', () => {
  it('filters, searches, sorts and paginates', async () => {
    const tag = `List-${Date.now()}`;
    await createContract(owner, { title: `${tag} alpha`, value: 100, type: 'NDA' });
    await createContract(owner, { title: `${tag} beta`, value: 300 });
    await createContract(owner, { title: `${tag} gamma`, value: 200 });

    const byValue = await owner.get(`/api/contracts?q=${tag}&sort=value&order=desc`);
    expect(byValue.body.items.map((c: { title: string }) => c.title)).toEqual([`${tag} beta`, `${tag} gamma`, `${tag} alpha`]);

    const vendors = await owner.get(`/api/contracts?q=${tag}&type=VENDOR&status=DRAFT,SUBMITTED`);
    expect(vendors.body.total, JSON.stringify(vendors.body)).toBe(2);

    const page2 = await owner.get(`/api/contracts?q=${tag}&sort=title&order=asc&pageSize=2&page=2`);
    expect(page2.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page2.body.items.map((c: { title: string }) => c.title)).toEqual([`${tag} gamma`]);

    expect((await owner.get('/api/contracts?status=BOGUS')).status).toBe(400);
  });
});

describe('attachments', () => {
  it('adds, downloads and removes supporting files', async () => {
    const { id } = await createContract();
    const add = await owner
      .post(`/api/contracts/${id}/attachments`)
      .field('description', 'Vendor quote')
      .attach('file', Buffer.from('item,price\nhosting,12000\n'), { filename: 'quote.csv' });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body).toMatchObject({ kind: 'SUPPORTING', description: 'Vendor quote', file: { mimeType: 'text/csv' } });

    const detail = await owner.get(`/api/contracts/${id}`);
    expect(detail.body.attachments).toHaveLength(1);

    const dl = await colleague.get(`/api/contracts/${id}/attachments/${add.body.id}/download`).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.text ?? (dl.body as Buffer).toString()).toContain('hosting,12000');

    expect((await colleague.delete(`/api/contracts/${id}/attachments/${add.body.id}`)).status).toBe(403);
    expect((await owner.delete(`/api/contracts/${id}/attachments/${add.body.id}`)).status).toBe(204);
    expect((await owner.get(`/api/contracts/${id}`)).body.attachments).toHaveLength(0);
  });

  it('only accepts a signed copy on a signed contract', async () => {
    const { id } = await createContract();
    const res = await owner
      .post(`/api/contracts/${id}/attachments`)
      .field('kind', 'SIGNED_COPY')
      .attach('file', PDF, { filename: 'signed.pdf' });
    expect(res.status).toBe(409);
  });
});

describe('counterparties', () => {
  it('creates and searches counterparties', async () => {
    const name = `Umbrella ${Date.now()}`;
    const created = await owner.post('/api/counterparties').send({ name, email: 'legal@umbrella.example' });
    expect(created.status).toBe(201);
    const found = await outsider.get(`/api/counterparties?q=${encodeURIComponent(name)}`);
    expect(found.body.map((c: { id: string }) => c.id)).toEqual([created.body.id]);
  });
});
