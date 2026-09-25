import { z } from 'zod';
import { ContractStatus, ContractType } from '../../generated/prisma/enums.js';

/** Money as a non-negative decimal with at most 2 decimals, accepted as number or string. */
const Money = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), 'Must be a non-negative amount with at most 2 decimals')
  .transform((v) => Number(v).toFixed(2));

const IsoDate = z.iso.date();

const Clause = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use lowercase letters, digits, "-" or "_"'),
  heading: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
});

const Clauses = z
  .array(Clause)
  .max(200)
  .refine((cs) => new Set(cs.map((c) => c.key)).size === cs.length, 'Clause keys must be unique');

/** Fields shared by create and update. */
const ContentFields = {
  title: z.string().trim().min(3).max(200),
  type: z.enum(ContractType),
  counterpartyId: z.uuid(),
  value: Money.nullable(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'ISO 4217 code, e.g. USD')
    .transform((c) => c.toUpperCase()),
  startDate: IsoDate.nullable(),
  endDate: IsoDate.nullable(),
  autoRenew: z.boolean(),
  clauses: Clauses,
  changeSummary: z.string().trim().max(500),
};

function datesInOrder(v: { startDate?: string | null; endDate?: string | null }) {
  return !v.startDate || !v.endDate || v.endDate >= v.startDate;
}
const DATE_ORDER = { message: 'endDate must be on or after startDate', path: ['endDate'] };

export const CreateContractBody = z
  .object({
    ...ContentFields,
    value: ContentFields.value.optional(),
    currency: ContentFields.currency.default('USD'),
    startDate: ContentFields.startDate.optional(),
    endDate: ContentFields.endDate.optional(),
    autoRenew: ContentFields.autoRenew.default(false),
    clauses: ContentFields.clauses.optional(),
    changeSummary: ContentFields.changeSummary.optional(),
    /** Build the clauses from a template (ignored when `clauses` is given). */
    templateId: z.uuid().optional(),
    /** Admins may file a contract under another department; others use their own. */
    departmentId: z.uuid().optional(),
  })
  .refine(datesInOrder, DATE_ORDER);
export type CreateContractBody = z.infer<typeof CreateContractBody>;

export const UpdateContractBody = z
  .object({
    /**
     * The version the client was editing. If someone saved a newer one in the
     * meantime the update is refused (409) instead of silently overwriting it.
     */
    expectedVersion: z.number().int().positive(),
    title: ContentFields.title.optional(),
    type: ContentFields.type.optional(),
    counterpartyId: ContentFields.counterpartyId.optional(),
    value: ContentFields.value.optional(),
    currency: ContentFields.currency.optional(),
    startDate: ContentFields.startDate.optional(),
    endDate: ContentFields.endDate.optional(),
    autoRenew: ContentFields.autoRenew.optional(),
    clauses: ContentFields.clauses.optional(),
    changeSummary: ContentFields.changeSummary.optional(),
    /** Drop the current document from the new version (a new upload replaces it anyway). */
    removeDocument: z.boolean().optional(),
  })
  .refine(datesInOrder, DATE_ORDER);
export type UpdateContractBody = z.infer<typeof UpdateContractBody>;

/** A comma-separated query parameter of enum values, e.g. ?status=DRAFT,SUBMITTED */
const csvEnum = <E extends Record<string, string>>(values: E) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1))
    .optional();

export const ListContractsQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: csvEnum(ContractStatus),
  type: csvEnum(ContractType),
  departmentId: z.uuid().optional(),
  counterpartyId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  /** Contracts whose end date falls on or before this day, e.g. "expiring by". */
  endsBefore: IsoDate.optional(),
  sort: z.enum(['updatedAt', 'createdAt', 'title', 'value', 'endDate', 'referenceNumber']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListContractsQuery = z.infer<typeof ListContractsQuery>;

export const IdParams = z.object({ id: z.uuid() });
export const VersionParams = z.object({ id: z.uuid(), versionNumber: z.coerce.number().int().positive() });
export const AttachmentParams = z.object({ id: z.uuid(), attachmentId: z.uuid() });

export const DiffQuery = z.object({ from: z.coerce.number().int().positive(), to: z.coerce.number().int().positive() });

export const AttachmentBody = z.object({
  kind: z.enum(['SUPPORTING', 'SIGNED_COPY']).default('SUPPORTING'),
  description: z.string().trim().max(500).optional(),
});
