import type { AuthUser } from '../../common/auth/auth-user.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma, type DbClient } from '../../lib/prisma.js';
import { storedFileSelect } from '../files/file.service.js';
import { contractVisibilityFilter } from './contract-access.js';
import type { ListContractsQuery } from './contract.schemas.js';

const userSummary = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

export const contractListSelect = {
  id: true,
  referenceNumber: true,
  title: true,
  type: true,
  status: true,
  value: true,
  currency: true,
  startDate: true,
  endDate: true,
  autoRenew: true,
  currentVersionNumber: true,
  createdAt: true,
  updatedAt: true,
  counterparty: { select: { id: true, name: true } },
  owner: userSummary,
  department: { select: { id: true, name: true, code: true } },
} satisfies Prisma.ContractSelect;

export const versionSummarySelect = {
  id: true,
  versionNumber: true,
  title: true,
  changeSummary: true,
  contentHash: true,
  createdAt: true,
  createdBy: userSummary,
  file: { select: storedFileSelect },
} satisfies Prisma.ContractVersionSelect;

export const versionDetailSelect = {
  ...versionSummarySelect,
  type: true,
  counterparty: { select: { id: true, name: true, kind: true } },
  value: true,
  currency: true,
  startDate: true,
  endDate: true,
  templateId: true,
  clauses: { select: { id: true, key: true, position: true, heading: true, body: true }, orderBy: { position: 'asc' } },
} satisfies Prisma.ContractVersionSelect;

export const attachmentSelect = {
  id: true,
  kind: true,
  description: true,
  createdAt: true,
  file: { select: { ...storedFileSelect, uploadedBy: userSummary } },
} satisfies Prisma.ContractAttachmentSelect;

/** Version content as the hashing/diff helpers need it. */
export const versionContentSelect = {
  id: true,
  versionNumber: true,
  title: true,
  type: true,
  counterpartyId: true,
  value: true,
  currency: true,
  startDate: true,
  endDate: true,
  fileId: true,
  file: { select: { sha256: true } },
  clauses: { select: { key: true, heading: true, body: true }, orderBy: { position: 'asc' } },
} satisfies Prisma.ContractVersionSelect;

/** Sort columns that can be null (Prisma only accepts `nulls:` on those). */
const NULLABLE_SORTS = new Set<ListContractsQuery['sort']>(['value', 'endDate']);

export const contractRepository = {
  /** Visible contract or null. Out-of-scope contracts look exactly like missing ones. */
  findVisible(user: AuthUser, id: string, db: DbClient = prisma) {
    return db.contract.findFirst({ where: { AND: [{ id }, contractVisibilityFilter(user)] } });
  },

  async list(user: AuthUser, query: ListContractsQuery) {
    const where: Prisma.ContractWhereInput = {
      AND: [
        contractVisibilityFilter(user),
        query.status ? { status: { in: query.status } } : {},
        query.type ? { type: { in: query.type } } : {},
        query.departmentId ? { departmentId: query.departmentId } : {},
        query.counterpartyId ? { counterpartyId: query.counterpartyId } : {},
        query.ownerId ? { ownerId: query.ownerId } : {},
        query.endsBefore ? { endDate: { lte: new Date(query.endsBefore) } } : {},
        query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { referenceNumber: { contains: query.q, mode: 'insensitive' } },
                { counterparty: { name: { contains: query.q, mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    };
    // Two independent reads rather than a batch transaction: the pg adapter runs a
    // batch's queries concurrently on one connection, which pg deprecates.
    const [total, items] = await Promise.all([
      prisma.contract.count({ where }),
      prisma.contract.findMany({
        where,
        select: contractListSelect,
        // Contracts without a value/end date sort last either way. `id` breaks
        // ties, which keeps pagination stable when sort values repeat.
        orderBy: [
          { [query.sort]: NULLABLE_SORTS.has(query.sort) ? { sort: query.order, nulls: 'last' } : query.order },
          { id: 'asc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  },

  findDetail(id: string, db: DbClient = prisma) {
    return db.contract.findUniqueOrThrow({
      where: { id },
      select: {
        ...contractListSelect,
        activatedAt: true,
        terminatedAt: true,
        terminationReason: true,
        renewalOfId: true,
        renewalOf: { select: { id: true, referenceNumber: true, title: true, status: true } },
        renewedBy: { select: { id: true, referenceNumber: true, title: true, status: true } },
        attachments: { select: attachmentSelect, orderBy: { createdAt: 'asc' } },
        approvalRequests: {
          select: { id: true, status: true, currentStage: true, submittedAt: true, completedAt: true },
          orderBy: { submittedAt: 'desc' },
          take: 1,
        },
      },
    });
  },

  findVersion(contractId: string, versionNumber: number, db: DbClient = prisma) {
    return db.contractVersion.findUnique({
      where: { contractId_versionNumber: { contractId, versionNumber } },
      select: versionDetailSelect,
    });
  },

  findVersionContent(contractId: string, versionNumber: number, db: DbClient = prisma) {
    return db.contractVersion.findUnique({
      where: { contractId_versionNumber: { contractId, versionNumber } },
      select: versionContentSelect,
    });
  },

  listVersions(contractId: string) {
    return prisma.contractVersion.findMany({
      where: { contractId },
      select: versionSummarySelect,
      orderBy: { versionNumber: 'desc' },
    });
  },

  timeline(contractId: string) {
    return prisma.contractStatusChange.findMany({
      where: { contractId },
      select: { id: true, fromStatus: true, toStatus: true, reason: true, createdAt: true, actor: userSummary },
      orderBy: { createdAt: 'asc' },
    });
  },
};
