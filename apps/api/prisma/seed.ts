/**
 * Demo data. Idempotent: safe to run repeatedly (upserts by unique keys).
 *
 * Every demo account uses the password below. Demo contracts are created
 * through ContractService (not raw inserts), so they get real versions, content
 * hashes, a timeline and audit entries, exactly like contracts made in the app.
 */
import { runWithContext } from '../src/common/context/request-context.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import type { Role } from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '../src/lib/storage.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { contractService } from '../src/modules/contracts/contract.service.js';
import { renewalService } from '../src/modules/renewals/renewal.service.js';
import { signingService } from '../src/modules/signing/signing.service.js';
import { escalationService } from '../src/modules/workflow/escalation.service.js';
import { seedPortfolio } from './seed-portfolio.js';
import { approvalService } from '../src/modules/workflow/approval.service.js';

export const DEMO_PASSWORD = 'Demo1234!';

const departments = [
  { code: 'LEG', name: 'Legal' },
  { code: 'FIN', name: 'Finance' },
  { code: 'SAL', name: 'Sales' },
  { code: 'PRC', name: 'Procurement' },
  { code: 'OPS', name: 'Operations' },
  { code: 'HR', name: 'Human Resources' },
  { code: 'IT', name: 'IT' },
  { code: 'MKT', name: 'Marketing' },
] as const;

type DeptCode = (typeof departments)[number]['code'];

const users: { email: string; firstName: string; lastName: string; role: Role; dept: DeptCode; head?: boolean }[] = [
  { email: 'admin@contracthub.dev', firstName: 'Alex', lastName: 'Morgan', role: 'ADMIN', dept: 'OPS', head: true },
  { email: 'legal@contracthub.dev', firstName: 'Leila', lastName: 'Haddad', role: 'LEGAL', dept: 'LEG', head: true },
  { email: 'legal2@contracthub.dev', firstName: 'Karim', lastName: 'Mansour', role: 'LEGAL', dept: 'LEG' },
  { email: 'finance@contracthub.dev', firstName: 'Farah', lastName: 'Ben Ali', role: 'FINANCE', dept: 'FIN', head: true },
  { email: 'sales.manager@contracthub.dev', firstName: 'Sarah', lastName: 'Collins', role: 'MANAGER', dept: 'SAL', head: true },
  { email: 'sales@contracthub.dev', firstName: 'Sami', lastName: 'Trabelsi', role: 'EMPLOYEE', dept: 'SAL' },
  { email: 'procurement.manager@contracthub.dev', firstName: 'Omar', lastName: 'Khalil', role: 'MANAGER', dept: 'PRC', head: true },
  { email: 'procurement@contracthub.dev', firstName: 'Nour', lastName: 'Saidi', role: 'EMPLOYEE', dept: 'PRC' },
  { email: 'amira.sales@contracthub.dev', firstName: 'Amira', lastName: 'Ben Salah', role: 'EMPLOYEE', dept: 'SAL' },
  { email: 'finance2@contracthub.dev', firstName: 'Olivier', lastName: 'Martin', role: 'FINANCE', dept: 'FIN' },
  { email: 'hr.manager@contracthub.dev', firstName: 'Yasmine', lastName: 'Belhadj', role: 'MANAGER', dept: 'HR', head: true },
  { email: 'hr@contracthub.dev', firstName: 'Lina', lastName: 'Chaabane', role: 'EMPLOYEE', dept: 'HR' },
  { email: 'it.manager@contracthub.dev', firstName: 'Mehdi', lastName: 'Jlassi', role: 'MANAGER', dept: 'IT', head: true },
  { email: 'it@contracthub.dev', firstName: 'Rania', lastName: 'Ferchichi', role: 'EMPLOYEE', dept: 'IT' },
  { email: 'marketing.manager@contracthub.dev', firstName: 'Claire', lastName: 'Dubois', role: 'MANAGER', dept: 'MKT', head: true },
  { email: 'marketing@contracthub.dev', firstName: 'Youssef', lastName: 'Gharbi', role: 'EMPLOYEE', dept: 'MKT' },
];

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const deptIds = new Map<DeptCode, string>();
  for (const d of departments) {
    const dept = await prisma.department.upsert({ where: { code: d.code }, update: { name: d.name }, create: d });
    deptIds.set(d.code, dept.id);
  }

  for (const u of users) {
    const departmentId = deptIds.get(u.dept)!;
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { firstName: u.firstName, lastName: u.lastName, role: u.role, departmentId, isActive: true },
      create: { email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, departmentId, passwordHash },
    });
    if (u.head) await prisma.department.update({ where: { id: departmentId }, data: { headId: user.id } });
  }

  await seedWorkflowTemplates();
  const counterparties = await seedCounterparties();
  const ndaTemplateId = await seedContractTemplate();
  const created =
    (await seedDemoContracts(counterparties, ndaTemplateId)) + (await seedLifecycleStories(counterparties)) + (await seedPortfolio());

  // Let the schedulers catch up on the backdated history: overdue approvals are
  // escalated, contracts past their end date expire or renew, reminders go out.
  const renewals = await renewalService.runOnce();
  const { escalated } = await escalationService.runOnce();
  console.log(`Schedulers: ${renewals.expired} expired, ${renewals.autoRenewed} renewed automatically, ${renewals.reminded} reminders, ${escalated} escalations`);

  console.log(
    `Seeded ${departments.length} departments, ${users.length} users (password: ${DEMO_PASSWORD}), ` +
      `${workflowTemplates.length} approval policies, ${created} new demo contracts`,
  );
}

// -----------------------------------------------------------------------------
//  Approval policies
// -----------------------------------------------------------------------------

type StepSeed = Omit<Prisma.WorkflowStepTemplateCreateWithoutWorkflowTemplateInput, 'condition'> & {
  condition?: Prisma.InputJsonValue;
};

const MANAGER: StepSeed = { stage: 1, name: 'Manager approval', approverRole: 'MANAGER', approverScope: 'CONTRACT_DEPARTMENT', escalateAfterHours: 48 };
const LEGAL: StepSeed = { stage: 2, name: 'Legal review', approverRole: 'LEGAL', approverScope: 'ANY', escalateAfterHours: 72 };
const FINANCE: StepSeed = {
  stage: 2,
  name: 'Finance review',
  approverRole: 'FINANCE',
  approverScope: 'ANY',
  condition: { field: 'value', op: 'gt', value: 10000 },
  escalateAfterHours: 48,
};

const workflowTemplates: { name: string; description: string; contractType: 'NDA' | 'VENDOR' | null; steps: StepSeed[] }[] = [
  {
    name: 'Standard approval',
    description: 'Default policy: the department manager, then Legal, with Finance in parallel above 10,000.',
    contractType: null,
    steps: [MANAGER, LEGAL, FINANCE],
  },
  {
    name: 'NDA fast track',
    description: 'NDAs carry no financial commitment: a single Legal review.',
    contractType: 'NDA',
    steps: [{ ...LEGAL, stage: 1, escalateAfterHours: 24 }],
  },
  {
    name: 'Vendor contracts',
    description: 'Manager, then Legal and Finance (above 10,000) in parallel, then an executive sign-off above 100,000.',
    contractType: 'VENDOR',
    steps: [
      MANAGER,
      LEGAL,
      FINANCE,
      {
        stage: 3,
        name: 'Executive sign-off',
        approverRole: 'ADMIN',
        approverScope: 'ANY',
        condition: { field: 'value', op: 'gt', value: 100000 },
        escalateAfterHours: 24,
      },
    ],
  },
];

/** Created once by name; later edits made through the admin API are left alone. */
async function seedWorkflowTemplates() {
  for (const t of workflowTemplates) {
    if (await prisma.workflowTemplate.findFirst({ where: { name: t.name } })) continue;
    await prisma.workflowTemplate.create({
      data: {
        name: t.name,
        description: t.description,
        contractType: t.contractType,
        steps: { create: t.steps },
      },
    });
  }
}

// -----------------------------------------------------------------------------
//  Counterparties, clause template, demo contracts
// -----------------------------------------------------------------------------

const counterpartySeeds = [
  { name: 'Acme Cloud Ltd', email: 'contracts@acme-cloud.example', contactName: 'Jordan Blake', registrationNumber: 'GB-0931442' },
  { name: 'Globex Corporation', email: 'legal@globex.example', contactName: 'Mina Park', registrationNumber: 'US-7781203' },
  { name: 'Initech Office Supplies', email: 'sales@initech.example', contactName: 'Peter Gibbons', registrationNumber: 'US-5510987' },
  { name: 'Northwind Traders', email: 'procurement@northwind.example', contactName: 'Ana Trujillo', registrationNumber: 'FR-81234567' },
  { name: 'Contoso Analytics', email: 'legal@contoso.example', contactName: 'Diego Roel', registrationNumber: 'IE-3345120' },
  { name: 'Fabrikam Consulting', email: 'partners@fabrikam.example', contactName: 'Hanna Moos', registrationNumber: 'DE-HRB-99120' },
] as const;

async function seedCounterparties() {
  const ids = new Map<string, string>();
  for (const c of counterpartySeeds) {
    const existing = await prisma.counterparty.findFirst({ where: { name: c.name } });
    ids.set(c.name, (existing ?? (await prisma.counterparty.create({ data: c }))).id);
  }
  return ids;
}

async function seedContractTemplate() {
  const name = 'Mutual NDA';
  const existing = await prisma.contractTemplate.findFirst({ where: { name } });
  if (existing) return existing.id;
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@contracthub.dev' } });
  const template = await prisma.contractTemplate.create({
    data: {
      name,
      type: 'NDA',
      description: 'Standard two-way confidentiality agreement.',
      createdById: admin.id,
      clauses: [
        { key: 'parties', heading: 'Parties', body: 'This Mutual Non-Disclosure Agreement is made between Contract Hub Inc. and {{counterparty}}.' },
        { key: 'confidential-information', heading: 'Confidential information', body: 'Each party will protect the other party\'s confidential information with at least reasonable care and use it only to evaluate the proposed business relationship.' },
        { key: 'term', heading: 'Term', body: 'This agreement starts on {{startDate}} and ends on {{endDate}}. Confidentiality obligations survive for three years after it ends.' },
        { key: 'governing-law', heading: 'Governing law', body: 'This agreement is governed by the laws of the State of Delaware.' },
      ],
    },
  });
  return template.id;
}

/** Drafts ready to submit, covering the interesting routing cases. Created once, by title. */
async function seedDemoContracts(counterparties: Map<string, string>, ndaTemplateId: string) {
  const demos = [
    {
      owner: 'sales@contracthub.dev',
      body: {
        title: 'Acme Cloud hosting 2027',
        type: 'VENDOR' as const,
        counterpartyId: counterparties.get('Acme Cloud Ltd')!,
        value: '45000.00',
        currency: 'USD',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        autoRenew: true,
        changeSummary: 'Initial draft from the Acme proposal',
        clauses: [
          { key: 'scope', heading: 'Scope of services', body: 'Acme Cloud Ltd provides managed hosting for the customer portal, with 99.9% monthly availability.' },
          { key: 'fees', heading: 'Fees', body: 'The customer pays 45,000 USD per year, invoiced quarterly in advance.' },
          { key: 'termination', heading: 'Termination', body: 'Either party may terminate with 90 days written notice.' },
        ],
      },
    },
    {
      owner: 'sales@contracthub.dev',
      body: {
        title: 'Mutual NDA with Globex',
        type: 'NDA' as const,
        counterpartyId: counterparties.get('Globex Corporation')!,
        currency: 'USD',
        startDate: '2026-10-01',
        endDate: '2028-09-30',
        autoRenew: false,
        templateId: ndaTemplateId,
      },
    },
    {
      owner: 'procurement@contracthub.dev',
      body: {
        title: 'Office supplies framework',
        type: 'VENDOR' as const,
        counterpartyId: counterparties.get('Initech Office Supplies')!,
        value: '8000.00',
        currency: 'USD',
        startDate: '2026-11-01',
        endDate: '2027-10-31',
        autoRenew: false,
        clauses: [
          { key: 'scope', heading: 'Scope', body: 'Initech supplies office consumables on demand, delivered within 2 business days.' },
          { key: 'fees', heading: 'Fees', body: 'Prices follow the attached catalogue; total spend is capped at 8,000 USD.' },
        ],
      },
    },
  ];

  // Two contracts already in force and ending soon, to show reminders and
  // renewals. Dates are relative to today so the demo never goes stale.
  const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const inForce = [
    {
      owner: 'sales@contracthub.dev',
      body: {
        title: 'Globex support retainer',
        type: 'CLIENT' as const,
        counterpartyId: counterparties.get('Globex Corporation')!,
        value: '18000.00',
        currency: 'USD',
        startDate: isoIn(-359),
        endDate: isoIn(6),
        autoRenew: false,
        clauses: [
          { key: 'scope', heading: 'Scope', body: 'Second-line support for the Globex integration, business hours.' },
          { key: 'fees', heading: 'Fees', body: '1,500 USD per month.' },
        ],
      },
    },
    {
      owner: 'procurement@contracthub.dev',
      body: {
        title: 'Initech printer lease',
        type: 'VENDOR' as const,
        counterpartyId: counterparties.get('Initech Office Supplies')!,
        value: '6000.00',
        currency: 'USD',
        startDate: isoIn(-340),
        endDate: isoIn(25),
        autoRenew: true,
        clauses: [{ key: 'lease', heading: 'Lease', body: 'Three multifunction printers, maintenance included.' }],
      },
    },
  ];

  let created = 0;
  for (const demo of inForce) {
    if (await prisma.contract.findFirst({ where: { title: demo.body.title } })) continue;
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: demo.owner } });
    const principal = { id: owner.id, email: owner.email, role: owner.role, departmentId: owner.departmentId };
    const contract = await runWithContext({ requestId: 'seed', user: principal }, () => contractService.create(principal, demo.body, null));
    // Imported as already signed and in force (demo data skips the approval round).
    await prisma.contract.update({ where: { id: contract.id }, data: { status: 'ACTIVE', activatedAt: new Date(demo.body.startDate) } });
    await prisma.contractStatusChange.create({
      data: { contractId: contract.id, fromStatus: 'DRAFT', toStatus: 'ACTIVE', actorId: owner.id, reason: 'Imported as an active contract (demo data)' },
    });
    created++;
  }

  for (const demo of demos) {
    if (await prisma.contract.findFirst({ where: { title: demo.body.title } })) continue;
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: demo.owner } });
    const principal = { id: owner.id, email: owner.email, role: owner.role, departmentId: owner.departmentId };
    await runWithContext({ requestId: 'seed', user: principal }, () => contractService.create(principal, demo.body, null));
    created++;
  }
  return created;
}

// -----------------------------------------------------------------------------
//  Lifecycle stories: contracts taken through the real workflow services, so
//  each one has a genuine timeline, approval trail, signatures and audit log.
// -----------------------------------------------------------------------------

type Principal = { id: string; email: string; role: Role; departmentId: string };

async function as(email: string): Promise<Principal> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, email: u.email, role: u.role, departmentId: u.departmentId };
}

/** Runs `fn` as `user`, the way a request would (so audit entries name them). */
function act<T>(user: Principal, fn: () => Promise<T>): Promise<T> {
  return runWithContext({ requestId: 'seed', ip: '127.0.0.1', userAgent: 'seed script', user }, fn);
}

/** Approves every pending step of a contract's current request, stage after stage. */
async function approveAll(contractId: string) {
  for (let guard = 0; guard < 10; guard++) {
    const step = await prisma.approvalStep.findFirst({ where: { status: 'PENDING', request: { contractId, status: 'IN_PROGRESS' } }, orderBy: { stage: 'asc' } });
    if (!step) return;
    const approver = await prisma.user.findFirstOrThrow({
      where: step.assigneeId
        ? { id: step.assigneeId }
        : { role: step.approverRole, isActive: true, ...(step.approverDepartmentId ? { departmentId: step.approverDepartmentId } : {}), NOT: { ownedContracts: { some: { id: contractId } } } },
      orderBy: { createdAt: 'asc' },
    });
    const principal = { id: approver.id, email: approver.email, role: approver.role, departmentId: approver.departmentId };
    await act(principal, () => approvalService.decide(principal, step.id, 'APPROVED', 'Looks good.'));
  }
}

async function seedLifecycleStories(counterparties: Map<string, string>) {
  const sami = await as('sales@contracthub.dev');
  const sarah = await as('sales.manager@contracthub.dev');
  const nour = await as('procurement@contracthub.dev');
  const leila = await as('legal@contracthub.dev');
  let created = 0;

  const story = async (owner: Principal, body: Parameters<typeof contractService.create>[1], then: (id: string) => Promise<void>) => {
    if (await prisma.contract.findFirst({ where: { title: body.title } })) return;
    const contract = await act(owner, () => contractService.create(owner, body, null));
    await then(contract.id);
    created++;
  };

  // In review: the manager approved; Legal and Finance are deciding in parallel.
  await story(
    sami,
    {
      title: 'Northwind distribution agreement',
      type: 'CLIENT',
      counterpartyId: counterparties.get('Northwind Traders')!,
      value: '120000.00',
      currency: 'EUR',
      startDate: '2027-01-01',
      endDate: '2028-12-31',
      autoRenew: false,
      clauses: [
        { key: 'territory', heading: 'Territory', body: 'Northwind distributes the products exclusively in France, Belgium and Luxembourg.' },
        { key: 'volumes', heading: 'Minimum volumes', body: 'Northwind commits to purchase at least 10,000 units per year.' },
        { key: 'payment', heading: 'Payment terms', body: 'Invoices are payable within 45 days of issue.' },
      ],
    },
    async (id) => {
      await act(sami, () => approvalService.submit(sami, id, 'Strategic account, please prioritise.'));
      const step = await prisma.approvalStep.findFirstOrThrow({ where: { status: 'PENDING', request: { contractId: id } } });
      await act(sarah, () => approvalService.decide(sarah, step.id, 'APPROVED', 'Volumes validated with the sales plan.'));
    },
  );

  // Rejected by Legal, with the reason on record: ready to be revised.
  await story(
    sami,
    {
      title: 'Contoso data processing addendum',
      type: 'NDA',
      counterpartyId: counterparties.get('Contoso Analytics')!,
      currency: 'USD',
      startDate: '2026-11-01',
      endDate: '2027-10-31',
      autoRenew: false,
      clauses: [
        { key: 'purpose', heading: 'Purpose', body: 'Contoso processes customer usage data to produce monthly analytics reports.' },
        { key: 'transfers', heading: 'International transfers', body: 'Data may be transferred to any Contoso affiliate.' },
      ],
    },
    async (id) => {
      await act(sami, () => approvalService.submit(sami, id));
      const step = await prisma.approvalStep.findFirstOrThrow({ where: { status: 'PENDING', request: { contractId: id } } });
      await act(leila, () =>
        approvalService.decide(leila, step.id, 'REJECTED', 'Unrestricted transfers to "any affiliate" are not acceptable. Limit them to the EEA or add standard contractual clauses.'),
      );
    },
  );

  // Approved, waiting for signatures.
  await story(
    nour,
    {
      title: 'Fabrikam process audit',
      type: 'VENDOR',
      counterpartyId: counterparties.get('Fabrikam Consulting')!,
      value: '9500.00',
      currency: 'EUR',
      startDate: '2026-11-15',
      endDate: '2027-02-15',
      autoRenew: false,
      clauses: [
        { key: 'scope', heading: 'Scope', body: 'Fabrikam audits the purchase-to-pay process and delivers a written report with recommendations.' },
        { key: 'fees', heading: 'Fees', body: 'Fixed fee of 9,500 EUR, payable on delivery of the final report.' },
      ],
    },
    async (id) => {
      await act(nour, () => approvalService.submit(nour, id));
      await approveAll(id);
      const omar = await as('procurement.manager@contracthub.dev');
      await act(nour, () =>
        signingService.setSigners(nour, id, {
          signers: [
            { userId: omar.id, signingOrder: 1 },
            { name: 'Hanna Moos', email: 'partners@fabrikam.example', signingOrder: 2 },
          ],
        }),
      );
    },
  );

  // Fully signed and in force: approvals, both signatures and the certificate.
  await story(
    sami,
    {
      title: 'Fabrikam sales training 2026',
      type: 'VENDOR',
      counterpartyId: counterparties.get('Fabrikam Consulting')!,
      value: '14500.00',
      currency: 'EUR',
      startDate: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 150 * 86_400_000).toISOString().slice(0, 10),
      autoRenew: false,
      clauses: [
        { key: 'scope', heading: 'Scope', body: 'Six on-site training days on consultative selling for the Sales team.' },
        { key: 'fees', heading: 'Fees', body: '14,500 EUR, invoiced in two instalments.' },
        { key: 'cancellation', heading: 'Cancellation', body: 'A session cancelled less than 10 days in advance is billed at 50%.' },
      ],
    },
    async (id) => {
      await act(sami, () => approvalService.submit(sami, id));
      await approveAll(id);
      await act(sami, () =>
        signingService.setSigners(sami, id, {
          signers: [
            { userId: sarah.id, signingOrder: 1 },
            { name: 'Hanna Moos', email: 'hanna.moos@fabrikam.example', signingOrder: 2 },
          ],
        }),
      );
      const { contentHash } = await act(sami, () => signingService.list(sami, id));
      await act(sarah, () => signingService.signAsUser(sarah, id, { contentHash: contentHash!, method: 'TYPED', typedName: 'Sarah Collins', consent: true }));
      // The external signer uses their emailed link; the seed reproduces that with a fresh link.
      const external = await prisma.contractSigner.findFirstOrThrow({ where: { contractId: id, userId: null } });
      const token = randomBytes(32).toString('base64url');
      await prisma.contractSigner.update({ where: { id: external.id }, data: { accessTokenHash: sha256Hex(token), accessTokenExpiresAt: new Date(Date.now() + 86_400_000) } });
      await runWithContext({ requestId: 'seed', ip: '203.0.113.24', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/135.0' }, () =>
        signingService.signByToken(token, { contentHash: contentHash!, method: 'TYPED', typedName: 'Hanna Moos', consent: true }),
      );
    },
  );

  return created;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
