import { EDITABLE_STATUSES, TERMINAL_STATUSES } from '@cms/shared';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import type { ValidatedUpload } from '../../common/middleware/upload.js';
import type { Contract, Prisma } from '../../generated/prisma/client.js';
import { prisma, type DbClient } from '../../lib/prisma.js';
import { recordAudit } from '../audit/audit.service.js';
import { fileService } from '../files/file.service.js';
import { contractLink, notify } from '../notifications/notification.service.js';
import {
  computeContentHash,
  diffContent,
  renderClauses,
  toIsoDate,
  type ClauseContent,
  type ContractContent,
} from './contract-content.js';
import { transitionContract } from './contract-status.js';
import { attachmentSelect, contractRepository } from './contract.repository.js';
import type { CreateContractBody, ListContractsQuery, UpdateContractBody } from './contract.schemas.js';

/**
 * Contracts: the mutable head row plus append-only versions.
 *
 * Every content change writes a new ContractVersion and refreshes the head's
 * denormalized fields in the same transaction. This service is the only writer
 * of either, which is what keeps them in sync.
 */
export const contractService = {
  list(user: AuthUser, query: ListContractsQuery) {
    return contractRepository.list(user, query);
  },

  async get(user: AuthUser, id: string) {
    await findVisibleOrThrow(user, id);
    const detail = await loadDetail(id);
    await recordAudit({ action: 'CONTRACT_VIEWED', entityType: 'contract', entityId: id, contractId: id });
    return detail;
  },

  async create(user: AuthUser, body: CreateContractBody, document: ValidatedUpload | null) {
    const departmentId = await resolveDepartment(user, body.departmentId);
    const counterparty = await prisma.counterparty.findUnique({ where: { id: body.counterpartyId } });
    if (!counterparty) throw new BadRequestError('Unknown counterparty');

    let clauses: ClauseContent[] = body.clauses ?? [];
    if (!body.clauses && body.templateId) {
      const template = await prisma.contractTemplate.findFirst({ where: { id: body.templateId, isActive: true } });
      if (!template) throw new BadRequestError('Unknown or inactive template');
      if (template.type !== body.type) throw new BadRequestError(`Template is for ${template.type} contracts`);
      clauses = renderClauses(template.clauses as unknown as ClauseContent[], {
        title: body.title,
        counterparty: counterparty.name,
        value: body.value ?? undefined,
        currency: body.currency,
        startDate: body.startDate ?? undefined,
        endDate: body.endDate ?? undefined,
      });
    }

    const id = await fileService.withStoredUpload(document, user.id, (saveFile) =>
      prisma.$transaction(async (tx) => {
        const file = saveFile ? await saveFile(tx) : null;
        const content: ContractContent = {
          title: body.title,
          type: body.type,
          counterpartyId: body.counterpartyId,
          value: body.value ?? null,
          currency: body.currency,
          startDate: body.startDate ?? null,
          endDate: body.endDate ?? null,
          clauses,
          fileSha256: file?.sha256 ?? null,
        };
        const contract = await tx.contract.create({
          data: {
            ...headFields(content),
            ownerId: user.id,
            departmentId,
            autoRenew: body.autoRenew,
            currentVersionNumber: 1,
          },
        });
        await writeVersion(tx, {
          contractId: contract.id,
          versionNumber: 1,
          content,
          fileId: file?.id ?? null,
          templateId: body.clauses ? null : (body.templateId ?? null),
          changeSummary: body.changeSummary ?? 'Initial draft',
          createdById: user.id,
        });
        await tx.contractStatusChange.create({
          data: { contractId: contract.id, fromStatus: null, toStatus: 'DRAFT', actorId: user.id },
        });
        await recordAudit(
          {
            action: 'CONTRACT_CREATED',
            entityType: 'contract',
            entityId: contract.id,
            contractId: contract.id,
            metadata: { referenceNumber: contract.referenceNumber, title: contract.title },
          },
          tx,
        );
        if (file) await auditUpload(tx, contract.id, file.id, document!, 'document');
        return contract.id;
      }),
    );
    return loadDetail(id);
  },

  /**
   * Saves an edit as version N+1. Only the owner (or an admin) may edit, and only
   * while the contract is editable. Editing a REJECTED contract is the "revise"
   * step: it moves the contract back to DRAFT, ready for resubmission.
   */
  async update(user: AuthUser, id: string, body: UpdateContractBody, document: ValidatedUpload | null) {
    const contract = await findVisibleOrThrow(user, id);
    assertCanEdit(user, contract);
    if (body.expectedVersion !== contract.currentVersionNumber) throw staleVersion(contract.currentVersionNumber);
    if (body.counterpartyId && !(await prisma.counterparty.findUnique({ where: { id: body.counterpartyId } }))) {
      throw new BadRequestError('Unknown counterparty');
    }

    await fileService.withStoredUpload(document, user.id, (saveFile) =>
      prisma.$transaction(async (tx) => {
        const current = await tx.contractVersion.findUniqueOrThrow({
          where: { contractId_versionNumber: { contractId: id, versionNumber: contract.currentVersionNumber } },
          include: { clauses: { orderBy: { position: 'asc' } }, file: { select: { sha256: true } } },
        });
        const file = saveFile ? await saveFile(tx) : null;
        const fileId = file ? file.id : body.removeDocument ? null : current.fileId;

        const before = contentOf(current);
        const after: ContractContent = {
          title: body.title ?? before.title,
          type: body.type ?? before.type,
          counterpartyId: body.counterpartyId ?? before.counterpartyId,
          value: body.value !== undefined ? body.value : before.value,
          currency: body.currency ?? before.currency,
          startDate: body.startDate !== undefined ? body.startDate : before.startDate,
          endDate: body.endDate !== undefined ? body.endDate : before.endDate,
          clauses: body.clauses ?? before.clauses,
          fileSha256: file ? file.sha256 : fileId ? before.fileSha256 : null,
        };
        if (after.startDate && after.endDate && after.endDate < after.startDate) {
          throw new BadRequestError('endDate must be on or after startDate');
        }

        const contentChanged = computeContentHash(after) !== current.contentHash;
        const autoRenewChanged = body.autoRenew !== undefined && body.autoRenew !== contract.autoRenew;
        if (!contentChanged && !autoRenewChanged) throw new BadRequestError('Nothing changed');

        const nextVersion = contentChanged ? contract.currentVersionNumber + 1 : contract.currentVersionNumber;
        // Compare-and-set on the version number: a concurrent edit that got in
        // first makes this a 409 rather than a lost update.
        const { count } = await tx.contract.updateMany({
          where: { id, currentVersionNumber: contract.currentVersionNumber },
          data: {
            ...headFields(after),
            currentVersionNumber: nextVersion,
            ...(body.autoRenew !== undefined ? { autoRenew: body.autoRenew } : {}),
          },
        });
        if (count !== 1) throw staleVersion();

        const diff = diffContent(before, after);
        if (contentChanged) {
          await writeVersion(tx, {
            contractId: id,
            versionNumber: nextVersion,
            content: after,
            fileId,
            templateId: current.templateId,
            changeSummary: body.changeSummary ?? null,
            createdById: user.id,
          });
        }
        if (contract.status === 'REJECTED') {
          await transitionContract(tx, {
            contractId: id,
            from: 'REJECTED',
            to: 'DRAFT',
            actorId: user.id,
            reason: body.changeSummary ?? 'Revised after rejection',
          });
        }
        await recordAudit(
          {
            action: 'CONTRACT_UPDATED',
            entityType: 'contract',
            entityId: id,
            contractId: id,
            metadata: {
              version: nextVersion,
              changedFields: diff.fields.map((f) => f.field),
              clauses: {
                added: diff.clauses.added.map((c) => c.key),
                removed: diff.clauses.removed.map((c) => c.key),
                changed: diff.clauses.changed.map((c) => c.key),
              },
              documentChanged: diff.documentChanged,
              autoRenewChanged,
            },
          },
          tx,
        );
        if (file) await auditUpload(tx, id, file.id, document!, 'document');
      }),
    );
    return loadDetail(id);
  },

  /**
   * Ends a contract before its term. Allowed to admins and to managers of the
   * contract's department (the contract.terminate permission, scoped to their
   * department). The reason is kept on the contract and in the timeline.
   */
  async terminate(user: AuthUser, id: string, reason: string) {
    const contract = await findVisibleOrThrow(user, id);
    if (user.role !== 'ADMIN' && contract.departmentId !== user.departmentId) {
      throw new ForbiddenError("Only an admin or a manager of the contract's department can terminate it");
    }
    if (!['ACTIVE', 'SIGNED'].includes(contract.status)) {
      throw new ConflictError(`Only a signed or active contract can be terminated (this one is ${contract.status})`);
    }
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await transitionContract(tx, {
        contractId: id,
        from: contract.status,
        to: 'TERMINATED',
        actorId: user.id,
        reason,
        data: { terminatedAt: now, terminationReason: reason },
      });
      await recordAudit({ action: 'CONTRACT_TERMINATED', entityType: 'contract', entityId: id, contractId: id, metadata: { reason } }, tx);
      if (contract.ownerId !== user.id) {
        await notify(tx, [contract.ownerId], {
          type: 'CONTRACT_EXPIRING',
          title: `${contract.referenceNumber} ${contract.title} was terminated`,
          body: `Reason: ${reason}`,
          contractId: id,
          link: contractLink(id),
        });
      }
    });
    return loadDetail(id);
  },

  /** The same list as `list`, unpaged (capped), for CSV export. */
  async exportRows(user: AuthUser, query: ListContractsQuery) {
    return (await contractRepository.list(user, { ...query, page: 1, pageSize: 5000 })).items;
  },

  async listVersions(user: AuthUser, id: string) {
    await findVisibleOrThrow(user, id);
    return contractRepository.listVersions(id);
  },

  async getVersion(user: AuthUser, id: string, versionNumber: number) {
    await findVisibleOrThrow(user, id);
    const version = await contractRepository.findVersion(id, versionNumber);
    if (!version) throw new NotFoundError('Version');
    return version;
  },

  async diff(user: AuthUser, id: string, from: number, to: number) {
    await findVisibleOrThrow(user, id);
    const [a, b] = await Promise.all([
      contractRepository.findVersionContent(id, from),
      contractRepository.findVersionContent(id, to),
    ]);
    if (!a || !b) throw new NotFoundError('Version');
    return { from, to, ...diffContent(contentOf(a), contentOf(b)) };
  },

  async timeline(user: AuthUser, id: string) {
    await findVisibleOrThrow(user, id);
    return contractRepository.timeline(id);
  },

  async openDocument(user: AuthUser, id: string, versionNumber: number) {
    await findVisibleOrThrow(user, id);
    const version = await prisma.contractVersion.findUnique({
      where: { contractId_versionNumber: { contractId: id, versionNumber } },
      select: { file: true },
    });
    if (!version) throw new NotFoundError('Version');
    if (!version.file) throw new NotFoundError('Document');
    await recordAudit({
      action: 'DOCUMENT_DOWNLOADED',
      entityType: 'file',
      entityId: version.file.id,
      contractId: id,
      metadata: { versionNumber, fileName: version.file.originalName },
    });
    return { file: version.file, stream: fileService.open(version.file.storageKey) };
  },

  /**
   * Supporting documents (quotes, annexes, correspondence) aren't part of the
   * versioned content, so they may be added in any non-terminal status. A signed
   * copy only makes sense once the contract has actually been signed.
   */
  async addAttachment(
    user: AuthUser,
    id: string,
    body: { kind: 'SUPPORTING' | 'SIGNED_COPY'; description?: string },
    upload: ValidatedUpload,
  ) {
    const contract = await findVisibleOrThrow(user, id);
    assertOwnerOrAdmin(user, contract);
    if (TERMINAL_STATUSES.includes(contract.status)) {
      throw new ConflictError(`Attachments can't be added to a ${contract.status} contract`);
    }
    if (body.kind === 'SIGNED_COPY' && !['SIGNED', 'ACTIVE'].includes(contract.status)) {
      throw new ConflictError('A signed copy can only be attached to a signed contract');
    }
    const attachmentId = await fileService.withStoredUpload(upload, user.id, (saveFile) =>
      prisma.$transaction(async (tx) => {
        const file = await saveFile!(tx);
        const attachment = await tx.contractAttachment.create({
          data: { contractId: id, fileId: file.id, kind: body.kind, description: body.description },
        });
        await auditUpload(tx, id, file.id, upload, 'attachment');
        return attachment.id;
      }),
    );
    return prisma.contractAttachment.findUniqueOrThrow({
      where: { id: attachmentId },
      select: attachmentSelect,
    });
  },

  /**
   * Detaches a supporting file. The stored file itself is kept: it may be
   * referenced from the audit trail, and history here is never destroyed.
   */
  async removeAttachment(user: AuthUser, id: string, attachmentId: string) {
    const contract = await findVisibleOrThrow(user, id);
    assertOwnerOrAdmin(user, contract);
    const attachment = await prisma.contractAttachment.findFirst({ where: { id: attachmentId, contractId: id } });
    if (!attachment) throw new NotFoundError('Attachment');
    if (attachment.kind === 'SIGNED_COPY') throw new ConflictError('A signed copy is evidence and cannot be removed');
    if (!EDITABLE_STATUSES.includes(contract.status)) {
      throw new ConflictError('Attachments can only be removed while the contract is a draft');
    }
    await prisma.$transaction(async (tx) => {
      await tx.contractAttachment.delete({ where: { id: attachmentId } });
      await recordAudit(
        {
          action: 'CONTRACT_UPDATED',
          entityType: 'attachment',
          entityId: attachmentId,
          contractId: id,
          metadata: { removedAttachment: attachmentId, fileId: attachment.fileId },
        },
        tx,
      );
    });
  },

  async openAttachment(user: AuthUser, id: string, attachmentId: string) {
    await findVisibleOrThrow(user, id);
    const attachment = await prisma.contractAttachment.findFirst({
      where: { id: attachmentId, contractId: id },
      select: { file: true },
    });
    if (!attachment) throw new NotFoundError('Attachment');
    await recordAudit({
      action: 'DOCUMENT_DOWNLOADED',
      entityType: 'file',
      entityId: attachment.file.id,
      contractId: id,
      metadata: { attachmentId, fileName: attachment.file.originalName },
    });
    return { file: attachment.file, stream: fileService.open(attachment.file.storageKey) };
  },
};

// -----------------------------------------------------------------------------
//  Helpers
// -----------------------------------------------------------------------------

export async function findVisibleOrThrow(user: AuthUser, id: string, db: DbClient = prisma): Promise<Contract> {
  const contract = await contractRepository.findVisible(user, id, db);
  if (!contract) throw new NotFoundError('Contract');
  return contract;
}

function assertOwnerOrAdmin(user: AuthUser, contract: Contract) {
  if (user.role !== 'ADMIN' && contract.ownerId !== user.id) {
    throw new ForbiddenError('Only the contract owner or an admin can do this');
  }
}

function assertCanEdit(user: AuthUser, contract: Contract) {
  assertOwnerOrAdmin(user, contract);
  if (!EDITABLE_STATUSES.includes(contract.status)) {
    throw new ConflictError(
      contract.status === 'APPROVED'
        ? 'This contract is approved. Reopen it as a draft to edit (it will need approval again).'
        : `A ${contract.status} contract can't be edited`,
    );
  }
}

function staleVersion(currentVersion?: number) {
  return new ConflictError(
    'This contract was edited by someone else. Reload to see the latest version before saving.',
    currentVersion ? { currentVersion } : undefined,
  );
}

async function resolveDepartment(user: AuthUser, requested: string | undefined): Promise<string> {
  if (!requested || requested === user.departmentId) return user.departmentId;
  if (user.role !== 'ADMIN') throw new ForbiddenError('You can only create contracts for your own department');
  const dept = await prisma.department.findUnique({ where: { id: requested } });
  if (!dept) throw new BadRequestError('Unknown department');
  return dept.id;
}

export async function loadDetail(id: string) {
  const { approvalRequests, ...contract } = await contractRepository.findDetail(id);
  const currentVersion = await contractRepository.findVersion(id, contract.currentVersionNumber);
  return { ...contract, currentVersion, latestApprovalRequest: approvalRequests[0] ?? null };
}

export function headFields(content: ContractContent) {
  return {
    title: content.title,
    type: content.type,
    counterpartyId: content.counterpartyId,
    value: content.value,
    currency: content.currency,
    startDate: content.startDate ? new Date(content.startDate) : null,
    endDate: content.endDate ? new Date(content.endDate) : null,
  };
}

export async function writeVersion(
  tx: DbClient,
  v: {
    contractId: string;
    versionNumber: number;
    content: ContractContent;
    fileId: string | null;
    templateId: string | null;
    changeSummary: string | null;
    createdById: string;
  },
) {
  await tx.contractVersion.create({
    data: {
      contractId: v.contractId,
      versionNumber: v.versionNumber,
      ...headFields(v.content),
      fileId: v.fileId,
      templateId: v.templateId,
      changeSummary: v.changeSummary,
      contentHash: computeContentHash(v.content),
      createdById: v.createdById,
      clauses: { create: v.content.clauses.map((c, i) => ({ ...c, position: i + 1 })) },
    },
  });
}

/** Normalizes a stored version into the shape the hashing and diff helpers use. */
export function contentOf(v: {
  title: string;
  type: ContractContent['type'];
  counterpartyId: string;
  value: Prisma.Decimal | null;
  currency: string;
  startDate: Date | null;
  endDate: Date | null;
  clauses: ClauseContent[];
  file: { sha256: string } | null;
}): ContractContent {
  return {
    title: v.title,
    type: v.type,
    counterpartyId: v.counterpartyId,
    value: v.value ? v.value.toFixed(2) : null,
    currency: v.currency,
    startDate: toIsoDate(v.startDate),
    endDate: toIsoDate(v.endDate),
    clauses: v.clauses.map((c) => ({ key: c.key, heading: c.heading, body: c.body })),
    fileSha256: v.file?.sha256 ?? null,
  };
}

async function auditUpload(
  tx: DbClient,
  contractId: string,
  fileId: string,
  upload: ValidatedUpload,
  purpose: 'document' | 'attachment',
) {
  await recordAudit(
    {
      action: 'DOCUMENT_UPLOADED',
      entityType: 'file',
      entityId: fileId,
      contractId,
      metadata: { purpose, fileName: upload.originalName, sizeBytes: upload.buffer.length },
    },
    tx,
  );
}
