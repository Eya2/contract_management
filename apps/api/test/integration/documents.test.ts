import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { renderContractPdf } from '../../src/modules/documents/contract-pdf.js';
import { clientFor, createCounterparty, createUser } from './helpers.js';

const app = createApp();
afterAll(() => prisma.$disconnect());

describe('contract PDF', () => {
  it('renders a version as an inline PDF, in English or French, for anyone who can see the contract', async () => {
    const owner = await clientFor(app, await createUser('EMPLOYEE'));
    const outsider = await clientFor(app, await createUser('EMPLOYEE'));
    const created = await owner.post('/api/contracts').send({
      title: 'Prestation de conseil',
      type: 'CLIENT',
      counterpartyId: (await createCounterparty()).id,
      value: 12000,
      currency: 'EUR',
      clauses: [{ key: 'objet', heading: 'Objet', body: 'Le prestataire réalise une mission de conseil ≥ 10 jours.' }],
    });
    const id = created.body.id as string;

    const en = await owner.get(`/api/contracts/${id}/versions/1/pdf`).buffer(true);
    expect(en.status).toBe(200);
    expect(en.headers['content-type']).toBe('application/pdf');
    expect(en.headers['content-disposition']).toMatch(/^inline; filename="CTR-\d{4}-\d{5}-v1\.pdf"$/);
    expect((en.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const fr = await owner.get(`/api/contracts/${id}/versions/1/pdf?lang=fr&download=1`).buffer(true);
    expect(fr.headers['content-disposition']).toMatch(/^attachment;/);
    expect((fr.body as Buffer).length).toBeGreaterThan(1000);

    expect((await outsider.get(`/api/contracts/${id}/versions/1/pdf`)).status).toBe(404);
    expect((await owner.get(`/api/contracts/${id}/versions/9/pdf`)).status).toBe(404);
    expect((await owner.get(`/api/contracts/${id}/versions/1/pdf?lang=de`)).status).toBe(400);
  });

  it('is not available through an unknown signing link', async () => {
    expect((await request(app).get(`/api/signing/${'B'.repeat(43)}/pdf`)).status).toBe(404);
  });

  it('stamps signatures and adds a certificate page once signed', async () => {
    const base = {
      lang: 'en' as const,
      company: 'Acme Inc.',
      reference: 'CTR-2026-00001',
      title: 'Test',
      type: 'NDA',
      status: 'ACTIVE',
      versionNumber: 1,
      contentHash: 'a'.repeat(64),
      generatedAt: new Date(),
      department: 'Legal',
      owner: { name: 'Owner', email: 'o@x.dev' },
      counterparty: { name: 'Other Ltd', email: null, contactName: null, registrationNumber: null },
      value: null,
      currency: 'USD',
      startDate: null,
      endDate: null,
      autoRenew: false,
      clauses: [{ heading: 'Confidentiality', body: 'Keep it secret.' }],
      document: null,
      approvals: [],
    };
    const signer = {
      name: 'Signer',
      email: 's@x.dev',
      internal: false,
      order: 1,
      method: 'TYPED' as const,
      typedSignature: 'Signer',
      signatureImage: null,
      ipAddress: '1.2.3.4',
      userAgent: 'test',
      signedContentHash: 'a'.repeat(64),
    };
    const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    const unsigned = await renderContractPdf({ ...base, signers: [{ ...signer, status: 'PENDING', signedAt: null }] });
    const signed = await renderContractPdf({ ...base, signers: [{ ...signer, status: 'SIGNED', signedAt: new Date() }] });
    expect(pageCount(unsigned)).toBe(1);
    expect(pageCount(signed)).toBe(2); // + signature certificate
  });
});
