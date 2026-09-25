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
import { hashPassword } from '../src/modules/auth/password.js';
import { contractService } from '../src/modules/contracts/contract.service.js';

export const DEMO_PASSWORD = 'Demo1234!';

const departments = [
  { code: 'LEG', name: 'Legal' },
  { code: 'FIN', name: 'Finance' },
  { code: 'SAL', name: 'Sales' },
  { code: 'PRC', name: 'Procurement' },
  { code: 'OPS', name: 'Operations' },
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
  const created = await seedDemoContracts(counterparties, ndaTemplateId);

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

  let created = 0;
  for (const demo of demos) {
    if (await prisma.contract.findFirst({ where: { title: demo.body.title } })) continue;
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: demo.owner } });
    const principal = { id: owner.id, email: owner.email, role: owner.role, departmentId: owner.departmentId };
    await runWithContext({ requestId: 'seed', user: principal }, () => contractService.create(principal, demo.body, null));
    created++;
  }
  return created;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
