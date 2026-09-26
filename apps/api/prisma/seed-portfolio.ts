/**
 * A realistic contract portfolio for demos: ~30 contracts across departments,
 * counterparties, currencies and every lifecycle state, spread over the past
 * 18 months.
 *
 * Every contract goes through the real services (create, edit, submit,
 * approve/reject, sign, terminate, renew), so versions, timelines, approval
 * trails, signatures and notifications are genuine. Afterwards their
 * timestamps are moved back in time so the history reads naturally (created
 * months ago, approved days later…). The audit log is the one exception: it is
 * append-only at the database level, so its entries keep the seed's date.
 */
import { randomBytes } from 'node:crypto';
import { runWithContext } from '../src/common/context/request-context.js';
import type { ContractType, Role } from '../src/generated/prisma/enums.js';
import { prisma } from '../src/lib/prisma.js';
import { sha256Hex } from '../src/lib/storage.js';
import { contractService } from '../src/modules/contracts/contract.service.js';
import { signingService } from '../src/modules/signing/signing.service.js';
import { approvalService } from '../src/modules/workflow/approval.service.js';

type Principal = { id: string; email: string; role: Role; departmentId: string };

type Scenario =
  | 'draft' // a draft with an edit history
  | 'in-review' // submitted, first stage approved
  | 'overdue' // submitted days ago, nobody decided: gets escalated
  | 'rejected' // rejected with a reason
  | 'revised' // rejected, revised as v2 and resubmitted
  | 'withdrawn' // submitted then withdrawn back to draft
  | 'awaiting-signature' // approved, internal signed, external pending
  | 'signed' // fully signed, starts in the future
  | 'active' // fully signed and in force
  | 'terminated' // in force, then terminated early
  | 'ended'; // term over: expires, or renews automatically (autoRenew)

interface Spec {
  title: string;
  type: ContractType;
  owner: string;
  counterparty: string;
  value: number | null;
  currency: string;
  /** Start date relative to today, in days (negative = in the past). */
  start: number;
  months: number;
  autoRenew?: boolean;
  scenario: Scenario;
  /** How long ago the contract was first drafted, in days. */
  age: number;
  reason?: string;
}

const DAY = 86_400_000;

// -----------------------------------------------------------------------------
//  Clause library
// -----------------------------------------------------------------------------

function money(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

function clausesFor(s: Spec) {
  const fee = s.value ? money(s.value, s.currency) : null;
  const law = s.currency === 'TND' ? 'Tunisia' : s.currency === 'GBP' ? 'England and Wales' : s.currency === 'USD' ? 'the State of New York' : 'France';
  const common = {
    confidentiality: {
      key: 'confidentiality',
      heading: 'Confidentiality',
      body: 'Each party keeps the other party’s confidential information secret, uses it only to perform this agreement, and returns or destroys it when the agreement ends. This obligation survives for three years after termination.',
    },
    liability: {
      key: 'liability',
      heading: 'Limitation of liability',
      body: `Except for breaches of confidentiality, gross negligence or wilful misconduct, each party’s total liability under this agreement is limited to ${fee ? 'the fees paid in the twelve months before the claim' : 'direct damages actually suffered'}.`,
    },
    termination: {
      key: 'termination',
      heading: 'Termination',
      body: 'Either party may terminate this agreement for material breach if the breach is not remedied within 30 days of written notice. Either party may also terminate for convenience with 90 days’ written notice.',
    },
    law: { key: 'governing-law', heading: 'Governing law', body: `This agreement is governed by the laws of ${law}. The courts of its capital have exclusive jurisdiction.` },
  };
  switch (s.type) {
    case 'NDA':
      return [
        { key: 'purpose', heading: 'Purpose', body: `The parties wish to exchange confidential information to evaluate a possible collaboration with ${s.counterparty}.` },
        { key: 'definition', heading: 'Confidential information', body: 'Confidential information means any non-public business, technical or financial information disclosed by one party to the other, in any form, marked or reasonably understood as confidential.' },
        { key: 'obligations', heading: 'Obligations', body: 'The receiving party protects confidential information with at least the care it applies to its own, and discloses it only to employees and advisers who need to know it and are bound by equivalent obligations.' },
        { key: 'duration', heading: 'Duration', body: `This agreement lasts ${s.months} months. The confidentiality obligations survive for three years after it ends.` },
        common.law,
      ];
    case 'EMPLOYMENT':
      return [
        { key: 'position', heading: 'Position', body: `The employee is hired as ${s.title.replace(/^Employment agreement – /, '')}, reporting to the head of department.` },
        { key: 'salary', heading: 'Remuneration', body: `Gross annual salary of ${fee}, paid monthly, reviewed each year.` },
        { key: 'probation', heading: 'Probation period', body: 'The first three months are a probation period, during which either party may end the contract with one week’s notice.' },
        { key: 'working-time', heading: 'Working time', body: 'Full time, 40 hours per week, with flexible hours and up to two days of remote work per week.' },
        common.confidentiality,
        common.law,
      ];
    case 'CLIENT':
      return [
        { key: 'services', heading: 'Services', body: `Contract Hub Inc. provides ${s.counterparty} with the services described in the order form, including onboarding, support and service updates.` },
        { key: 'fees', heading: 'Fees and payment', body: `${s.counterparty} pays ${fee} for the term, invoiced quarterly in advance. Invoices are payable within 30 days.` },
        { key: 'service-levels', heading: 'Service levels', body: 'Availability of 99.5% per calendar month. Service credits apply below that threshold, as set out in the service level schedule.' },
        common.confidentiality,
        common.liability,
        common.termination,
        common.law,
      ];
    default:
      return [
        { key: 'scope', heading: 'Scope of supply', body: `${s.counterparty} supplies the goods and services described in the statement of work, to the agreed quality standards and delivery dates.` },
        { key: 'price', heading: 'Price and invoicing', body: `The total price is ${fee}, exclusive of taxes. The supplier invoices monthly on delivery; payment is due within 45 days.` },
        { key: 'warranty', heading: 'Warranty', body: 'The supplier warrants that deliverables conform to the specifications for 12 months from acceptance and will correct any defect at its own cost.' },
        common.confidentiality,
        common.liability,
        common.termination,
        common.law,
      ];
  }
}

// -----------------------------------------------------------------------------
//  The portfolio
// -----------------------------------------------------------------------------

export const PORTFOLIO_COUNTERPARTIES = [
  { name: 'Tailspin Airlines', email: 'procurement@tailspin.example', contactName: 'Julien Moreau', registrationNumber: 'FR-44821907' },
  { name: 'Wingtip Toys', email: 'partners@wingtiptoys.example', contactName: 'Emily Carter', registrationNumber: 'US-3319054' },
  { name: 'Adventure Works Cycles', email: 'einkauf@adventure-works.example', contactName: 'Lukas Weber', registrationNumber: 'DE-HRB-40211' },
  { name: 'Litware Security', email: 'contracts@litware.example', contactName: 'Priya Nair', registrationNumber: 'US-7741820' },
  { name: 'Proseware Logistics', email: 'sales@proseware.example', contactName: 'Daan de Vries', registrationNumber: 'NL-58302194' },
  { name: 'Woodgrove Bank', email: 'vendor.management@woodgrove.example', contactName: 'Oliver Hughes', registrationNumber: 'GB-02210458' },
  { name: 'Lucerne Publishing', email: 'rights@lucerne.example', contactName: 'Anna Keller', registrationNumber: 'CH-220.3.041' },
  { name: 'Sfax Industries SA', email: 'achats@sfax-industries.example', contactName: 'Hatem Kammoun', registrationNumber: 'TN-B0152211' },
  { name: 'Carthage Travel SARL', email: 'contact@carthage-travel.example', contactName: 'Ines Jaziri', registrationNumber: 'TN-B2419870' },
  { name: 'Medina Catering', email: 'hello@medina-catering.example', contactName: 'Walid Ayari', registrationNumber: 'TN-B3310427' },
  { name: 'Blue Yonder Analytics', email: 'legal@blueyonder.example', contactName: 'Sophie Laurent', registrationNumber: 'FR-81077342' },
  { name: 'Alpine Ski House', email: 'events@alpineski.example', contactName: 'Marco Rossi', registrationNumber: 'CH-130.9.771' },
  // Future employees: employment contracts are with a person.
  { name: 'Nadia Ben Amor', kind: 'INDIVIDUAL', email: 'nadia.benamor@mail.example', contactName: 'Nadia Ben Amor' },
  { name: 'Hugo Lefebvre', kind: 'INDIVIDUAL', email: 'hugo.lefebvre@mail.example', contactName: 'Hugo Lefebvre' },
  { name: 'Aziz Hammami', kind: 'INDIVIDUAL', email: 'aziz.hammami@mail.example', contactName: 'Aziz Hammami' },
] as const;

const SPECS: Spec[] = [
  // Sales: client agreements
  { title: 'Tailspin Airlines – crew scheduling platform', type: 'CLIENT', owner: 'sales@contracthub.dev', counterparty: 'Tailspin Airlines', value: 186000, currency: 'EUR', start: -420, months: 24, scenario: 'active', age: 470 },
  { title: 'Woodgrove Bank – compliance reporting licence', type: 'CLIENT', owner: 'amira.sales@contracthub.dev', counterparty: 'Woodgrove Bank', value: 94500, currency: 'GBP', start: -300, months: 12, autoRenew: true, scenario: 'active', age: 330 },
  { title: 'Wingtip Toys – e-commerce analytics', type: 'CLIENT', owner: 'sales@contracthub.dev', counterparty: 'Wingtip Toys', value: 42000, currency: 'USD', start: -390, months: 12, autoRenew: true, scenario: 'ended', age: 420 },
  { title: 'Lucerne Publishing – rights management pilot', type: 'CLIENT', owner: 'amira.sales@contracthub.dev', counterparty: 'Lucerne Publishing', value: 18000, currency: 'EUR', start: -200, months: 6, scenario: 'ended', age: 230 },
  { title: 'Carthage Travel – booking engine subscription', type: 'CLIENT', owner: 'amira.sales@contracthub.dev', counterparty: 'Carthage Travel SARL', value: 36000, currency: 'TND', start: -150, months: 12, scenario: 'terminated', age: 175, reason: 'The client closed its online booking activity; both parties agreed to end the subscription early.' },
  { title: 'Alpine Ski House – season ticketing platform', type: 'CLIENT', owner: 'sales@contracthub.dev', counterparty: 'Alpine Ski House', value: 58000, currency: 'EUR', start: 45, months: 12, scenario: 'signed', age: 40 },
  { title: 'Blue Yonder Analytics – data platform partnership', type: 'CLIENT', owner: 'amira.sales@contracthub.dev', counterparty: 'Blue Yonder Analytics', value: 240000, currency: 'EUR', start: 30, months: 36, scenario: 'in-review', age: 5 },
  { title: 'Sfax Industries – maintenance portal', type: 'CLIENT', owner: 'sales@contracthub.dev', counterparty: 'Sfax Industries SA', value: 75000, currency: 'TND', start: 20, months: 12, scenario: 'overdue', age: 6 },
  { title: 'Woodgrove Bank – mobile onboarding module', type: 'CLIENT', owner: 'amira.sales@contracthub.dev', counterparty: 'Woodgrove Bank', value: 132000, currency: 'GBP', start: 60, months: 24, scenario: 'revised', age: 21, reason: 'The liability cap must exclude data protection breaches, as required by the bank’s regulator. Please revise clause 5.' },
  { title: 'Wingtip Toys – loyalty programme', type: 'CLIENT', owner: 'sales@contracthub.dev', counterparty: 'Wingtip Toys', value: 27500, currency: 'USD', start: 40, months: 12, scenario: 'draft', age: 3 },

  // Procurement: vendor agreements
  { title: 'Proseware Logistics – warehouse services', type: 'VENDOR', owner: 'procurement@contracthub.dev', counterparty: 'Proseware Logistics', value: 128000, currency: 'EUR', start: -500, months: 24, scenario: 'active', age: 540 },
  { title: 'Litware Security – penetration testing 2026', type: 'VENDOR', owner: 'procurement@contracthub.dev', counterparty: 'Litware Security', value: 22000, currency: 'USD', start: -90, months: 12, scenario: 'active', age: 110 },
  { title: 'Medina Catering – staff restaurant', type: 'VENDOR', owner: 'procurement@contracthub.dev', counterparty: 'Medina Catering', value: 96000, currency: 'TND', start: -370, months: 12, autoRenew: true, scenario: 'ended', age: 400 },
  { title: 'Adventure Works – bike-to-work fleet', type: 'VENDOR', owner: 'procurement@contracthub.dev', counterparty: 'Adventure Works Cycles', value: 31000, currency: 'EUR', start: -240, months: 6, scenario: 'ended', age: 260 },
  { title: 'Proseware Logistics – express courier', type: 'VENDOR', owner: 'procurement@contracthub.dev', counterparty: 'Proseware Logistics', value: 12000, currency: 'EUR', start: -120, months: 12, scenario: 'terminated', age: 140, reason: 'Repeated delivery delays in breach of the service levels; notice of termination sent on the 12th.' },
  { title: 'Litware Security – managed SOC', type: 'VENDOR', owner: 'procurement@contracthub.dev', counterparty: 'Litware Security', value: 168000, currency: 'USD', start: 15, months: 36, scenario: 'awaiting-signature', age: 12 },
  { title: 'Sfax Industries – office furniture', type: 'VENDOR', owner: 'procurement@contracthub.dev', counterparty: 'Sfax Industries SA', value: 48000, currency: 'TND', start: 25, months: 3, scenario: 'rejected', age: 9, reason: 'The quote does not include installation or the 5-year warranty we require. Ask the supplier for a revised offer.' },
  { title: 'Medina Catering – event catering framework', type: 'VENDOR', owner: 'procurement@contracthub.dev', counterparty: 'Medina Catering', value: 15000, currency: 'TND', start: 30, months: 12, scenario: 'withdrawn', age: 7 },

  // IT
  { title: 'Litware Security – endpoint protection licences', type: 'VENDOR', owner: 'it@contracthub.dev', counterparty: 'Litware Security', value: 38400, currency: 'USD', start: -60, months: 12, autoRenew: true, scenario: 'active', age: 80 },
  { title: 'Blue Yonder Analytics – cloud data warehouse', type: 'VENDOR', owner: 'it@contracthub.dev', counterparty: 'Blue Yonder Analytics', value: 72000, currency: 'EUR', start: 10, months: 12, scenario: 'awaiting-signature', age: 14 },
  { title: 'Adventure Works – laptop leasing', type: 'VENDOR', owner: 'it@contracthub.dev', counterparty: 'Adventure Works Cycles', value: 64000, currency: 'EUR', start: 30, months: 36, scenario: 'overdue', age: 5 },

  // Marketing
  { title: 'Lucerne Publishing – sponsored content series', type: 'VENDOR', owner: 'marketing@contracthub.dev', counterparty: 'Lucerne Publishing', value: 16500, currency: 'EUR', start: -45, months: 6, scenario: 'active', age: 70 },
  { title: 'Alpine Ski House – winter event sponsorship', type: 'VENDOR', owner: 'marketing@contracthub.dev', counterparty: 'Alpine Ski House', value: 25000, currency: 'EUR', start: 50, months: 4, scenario: 'in-review', age: 2 },
  { title: 'Carthage Travel – incentive trip 2027', type: 'VENDOR', owner: 'marketing@contracthub.dev', counterparty: 'Carthage Travel SARL', value: 54000, currency: 'TND', start: 120, months: 1, scenario: 'draft', age: 1 },

  // NDAs
  { title: 'Mutual NDA – Tailspin Airlines', type: 'NDA', owner: 'sales@contracthub.dev', counterparty: 'Tailspin Airlines', value: null, currency: 'EUR', start: -480, months: 24, scenario: 'active', age: 490 },
  { title: 'Mutual NDA – Blue Yonder Analytics', type: 'NDA', owner: 'amira.sales@contracthub.dev', counterparty: 'Blue Yonder Analytics', value: null, currency: 'EUR', start: -40, months: 24, scenario: 'active', age: 45 },
  { title: 'NDA – Woodgrove Bank security review', type: 'NDA', owner: 'it@contracthub.dev', counterparty: 'Woodgrove Bank', value: null, currency: 'GBP', start: 5, months: 12, scenario: 'in-review', age: 1 },

  // HR: employment
  { title: 'Employment agreement – Senior Backend Engineer', type: 'EMPLOYMENT', owner: 'hr@contracthub.dev', counterparty: 'Nadia Ben Amor', value: 62000, currency: 'EUR', start: -210, months: 36, scenario: 'active', age: 230 },
  { title: 'Employment agreement – Product Designer', type: 'EMPLOYMENT', owner: 'hr@contracthub.dev', counterparty: 'Hugo Lefebvre', value: 48000, currency: 'EUR', start: 21, months: 36, scenario: 'awaiting-signature', age: 10 },
  { title: 'Employment agreement – Sales Intern', type: 'EMPLOYMENT', owner: 'hr@contracthub.dev', counterparty: 'Aziz Hammami', value: 9600, currency: 'TND', start: 14, months: 6, scenario: 'draft', age: 2 },
];

// -----------------------------------------------------------------------------
//  Driving the real services
// -----------------------------------------------------------------------------

async function as(email: string): Promise<Principal> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, email: u.email, role: u.role, departmentId: u.departmentId };
}

function act<T>(user: Principal, fn: () => Promise<T>): Promise<T> {
  return runWithContext({ requestId: 'seed', ip: '10.0.4.' + (20 + Math.floor(Math.random() * 30)), userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15', user }, fn);
}

/** Someone allowed to decide `step` who is not the requester. */
async function approverFor(stepId: string, contractId: string): Promise<Principal> {
  const step = await prisma.approvalStep.findUniqueOrThrow({ where: { id: stepId } });
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  const u = await prisma.user.findFirstOrThrow({
    where: step.assigneeId
      ? { id: step.assigneeId }
      : {
          role: step.approverRole,
          isActive: true,
          ...(step.approverDepartmentId ? { departmentId: step.approverDepartmentId } : {}),
          NOT: { id: contract.ownerId },
        },
    orderBy: { createdAt: 'asc' },
  });
  return { id: u.id, email: u.email, role: u.role, departmentId: u.departmentId };
}

const COMMENTS = ['Looks good.', 'Approved, budget confirmed.', 'OK from our side.', 'Terms validated.', 'Approved. Please keep the signed copy in the shared folder.'];

async function pendingSteps(contractId: string) {
  return prisma.approvalStep.findMany({ where: { status: 'PENDING', request: { contractId, status: 'IN_PROGRESS' } }, orderBy: { stage: 'asc' } });
}

async function approveStage(contractId: string) {
  for (const step of await pendingSteps(contractId)) {
    const approver = await approverFor(step.id, contractId);
    await act(approver, () => approvalService.decide(approver, step.id, 'APPROVED', COMMENTS[Math.floor(Math.random() * COMMENTS.length)]));
  }
}

async function approveAll(contractId: string) {
  for (let i = 0; i < 6 && (await pendingSteps(contractId)).length; i++) await approveStage(contractId);
}

async function rejectFirst(contractId: string, reason: string) {
  const [step] = await pendingSteps(contractId);
  const approver = await approverFor(step!.id, contractId);
  await act(approver, () => approvalService.decide(approver, step!.id, 'REJECTED', reason));
}

/** Internal manager of the owner's department + the counterparty's contact. */
async function chooseSigners(owner: Principal, contractId: string, counterparty: { contactName: string | null; email: string | null; name: string }) {
  const manager = await prisma.user.findFirst({ where: { departmentId: owner.departmentId, role: 'MANAGER', isActive: true } });
  const internal = manager ?? (await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } }));
  await act(owner, () =>
    signingService.setSigners(owner, contractId, {
      signers: [
        { userId: internal.id, signingOrder: 1 },
        { name: counterparty.contactName ?? counterparty.name, email: counterparty.email ?? 'contracts@example.com', signingOrder: 2 },
      ],
    }),
  );
  return { id: internal.id, email: internal.email, role: internal.role, departmentId: internal.departmentId };
}

async function signInternal(signer: Principal, contractId: string) {
  const { contentHash } = await act(signer, () => signingService.list(signer, contractId));
  const u = await prisma.user.findUniqueOrThrow({ where: { id: signer.id } });
  await act(signer, () => signingService.signAsUser(signer, contractId, { contentHash: contentHash!, method: 'TYPED', typedName: `${u.firstName} ${u.lastName}`, consent: true }));
}

/** The external signer uses their emailed link; the seed reproduces that with a fresh one. */
async function signExternal(contractId: string) {
  const external = await prisma.contractSigner.findFirstOrThrow({ where: { contractId, userId: null, status: 'PENDING' }, include: { version: true } });
  const token = randomBytes(32).toString('base64url');
  await prisma.contractSigner.update({ where: { id: external.id }, data: { accessTokenHash: sha256Hex(token), accessTokenExpiresAt: new Date(Date.now() + DAY) } });
  await runWithContext({ requestId: 'seed', ip: '198.51.100.' + (10 + Math.floor(Math.random() * 200)), userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36' }, () =>
    signingService.signByToken(token, { contentHash: external.version.contentHash, method: 'TYPED', typedName: external.name, consent: true }),
  );
}

async function play(spec: Spec, contractId: string, owner: Principal, cp: { contactName: string | null; email: string | null; name: string }) {
  const submit = () => act(owner, () => approvalService.submit(owner, contractId));
  const signFully = async () => {
    await approveAll(contractId);
    const internal = await chooseSigners(owner, contractId, cp);
    await signInternal(internal, contractId);
    await signExternal(contractId);
  };
  switch (spec.scenario) {
    case 'draft': {
      const c = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
      await act(owner, () =>
        contractService.update(owner, contractId, { expectedVersion: c.currentVersionNumber, value: spec.value ? (spec.value * 1.05).toFixed(2) : undefined, changeSummary: 'Updated the price after the second quote' }, null),
      );
      return;
    }
    case 'in-review':
      await submit();
      await approveStage(contractId);
      return;
    case 'overdue':
      await submit();
      return;
    case 'rejected':
      await submit();
      await rejectFirst(contractId, spec.reason!);
      return;
    case 'revised': {
      await submit();
      await approveStage(contractId);
      await rejectFirst(contractId, spec.reason!);
      const v = await prisma.contractVersion.findFirstOrThrow({ where: { contractId }, include: { clauses: { orderBy: { position: 'asc' } } }, orderBy: { versionNumber: 'desc' } });
      const clauses = v.clauses.map((c) =>
        c.key === 'liability'
          ? { key: c.key, heading: c.heading, body: c.body.replace('Except for breaches of confidentiality', 'Except for breaches of confidentiality or of data protection law') }
          : { key: c.key, heading: c.heading, body: c.body },
      );
      await act(owner, () => contractService.update(owner, contractId, { expectedVersion: v.versionNumber, clauses, changeSummary: 'Liability cap now excludes data protection breaches (regulator requirement)' }, null));
      await submit();
      return;
    }
    case 'withdrawn':
      await submit();
      await act(owner, () => approvalService.withdraw(owner, contractId, 'The supplier sent an updated price list; resubmitting next week.'));
      return;
    case 'awaiting-signature': {
      await submit();
      await approveAll(contractId);
      const internal = await chooseSigners(owner, contractId, cp);
      await signInternal(internal, contractId);
      return;
    }
    case 'signed':
    case 'active':
    case 'ended':
      await submit();
      await signFully();
      return;
    case 'terminated': {
      await submit();
      await signFully();
      const manager = await prisma.user.findFirstOrThrow({ where: { departmentId: owner.departmentId, role: 'MANAGER' } });
      const m = { id: manager.id, email: manager.email, role: manager.role, departmentId: manager.departmentId };
      await act(m, () => contractService.terminate(m, contractId, spec.reason!));
      return;
    }
  }
}

/**
 * Moves one contract's history back in time. Everything the seed just did (in a
 * fraction of a second) is stretched over the days between the contract's
 * drafting and now, keeping the order of events. Deadlines of open approval
 * steps are then recomputed from their (new) activation time.
 */
async function backdate(contractId: string, t0: Date, t1: Date, ageDays: number, spanDays: number) {
  const newStart = new Date(Date.now() - ageDays * DAY);
  const factor = (spanDays * DAY) / Math.max(1, t1.getTime() - t0.getTime());
  const shift = (col: string) => `${col} = CASE WHEN ${col} IS NULL THEN NULL ELSE $1::timestamp + ((${col} - $2::timestamp) * $3::float8) END`;
  const args = [newStart.toISOString().replace('Z', ''), t0.toISOString().replace('Z', ''), factor, contractId] as const;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql, ...args);
  await run(`UPDATE contracts SET ${shift('created_at')}, ${shift('updated_at')}, ${shift('activated_at')}, ${shift('terminated_at')} WHERE id = $4::uuid`);
  await run(`UPDATE contract_versions SET ${shift('created_at')} WHERE contract_id = $4::uuid`);
  await run(`UPDATE contract_status_changes SET ${shift('created_at')} WHERE contract_id = $4::uuid`);
  await run(`UPDATE approval_requests SET ${shift('submitted_at')}, ${shift('completed_at')} WHERE contract_id = $4::uuid`);
  await run(`UPDATE approval_steps SET ${shift('activated_at')}, ${shift('decided_at')} WHERE request_id IN (SELECT id FROM approval_requests WHERE contract_id = $4::uuid)`);
  await run(`UPDATE contract_signers SET ${shift('created_at')}, ${shift('signed_at')} WHERE contract_id = $4::uuid`);
  await run(`UPDATE notifications SET ${shift('created_at')} WHERE contract_id = $4::uuid`);
  await prisma.$executeRaw`
    UPDATE approval_steps SET due_at = activated_at + make_interval(hours => sla_hours)
    WHERE sla_hours IS NOT NULL AND activated_at IS NOT NULL
      AND request_id IN (SELECT id FROM approval_requests WHERE contract_id = ${contractId}::uuid)`;
}

/** Creates the portfolio (skipping contracts that already exist). Returns how many were created. */
export async function seedPortfolio(): Promise<number> {
  const counterparties = new Map<string, { id: string; contactName: string | null; email: string | null; name: string }>();
  for (const c of PORTFOLIO_COUNTERPARTIES) {
    const row = (await prisma.counterparty.findFirst({ where: { name: c.name } })) ?? (await prisma.counterparty.create({ data: { ...c } }));
    counterparties.set(c.name, row);
  }

  let created = 0;
  for (const spec of SPECS) {
    if (await prisma.contract.findFirst({ where: { title: spec.title } })) continue;
    const owner = await as(spec.owner);
    const cp = counterparties.get(spec.counterparty)!;
    const start = new Date(Date.now() + spec.start * DAY);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + spec.months);
    end.setUTCDate(end.getUTCDate() - 1);

    const t0 = new Date();
    const contract = await act(owner, () =>
      contractService.create(
        owner,
        {
          title: spec.title,
          type: spec.type,
          counterpartyId: cp.id,
          value: spec.value === null ? undefined : spec.value.toFixed(2),
          currency: spec.currency,
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          autoRenew: spec.autoRenew ?? false,
          clauses: clausesFor(spec),
          changeSummary: 'First draft from the negotiated term sheet',
        },
        null,
      ),
    );
    await play(spec, contract.id, owner, cp);
    const t1 = new Date();
    // Drafting to the last event spans most of the contract's age; recent ones end close to now.
    await backdate(contract.id, t0, t1, spec.age, Math.max(0.2, spec.age * 0.85));
    created++;
  }
  return created;
}
