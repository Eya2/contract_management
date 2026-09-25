import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { hasPermission, Permission } from '../../common/auth/permissions.js';
import { getRequestContext } from '../../common/context/request-context.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/app-error.js';
import type { Contract, ContractSigner, Prisma } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';
import { prisma, type DbClient } from '../../lib/prisma.js';
import { sha256Hex } from '../../lib/storage.js';
import { recordAudit } from '../audit/audit.service.js';
import { transitionContract } from '../contracts/contract-status.js';
import { contractRepository } from '../contracts/contract.repository.js';
import { findVisibleOrThrow } from '../contracts/contract.service.js';
import { fileService, storedFileSelect } from '../files/file.service.js';
import { contractLink, notify } from '../notifications/notification.service.js';
import type { SignBody, SignersBody } from './signing.schemas.js';

/**
 * E-signature for approved contracts.
 *
 * Signers are bound to the approved version. Internal signers act from their
 * account; external signers (the counterparty) get a one-time emailed link
 * whose token is stored only as a hash. Signing follows `signingOrder`: the
 * lowest order with pending signers is "up" (same order = in parallel).
 *
 * Each signature stores its evidence: method, typed name or drawn image,
 * timestamp, IP, user agent, and the content hash that was on screen, which
 * must equal the version's hash at the moment of signing. When the last
 * signer signs, the contract becomes ACTIVE (or SIGNED until its start date).
 * A decline sends it back to DRAFT for renegotiation.
 */

const LINK_TTL_DAYS = 14;

const signerSelect = {
  id: true,
  userId: true,
  name: true,
  email: true,
  signingOrder: true,
  status: true,
  method: true,
  typedSignature: true,
  signedContentHash: true,
  signedAt: true,
  ipAddress: true,
  declineReason: true,
  createdAt: true,
  signatureFile: { select: storedFileSelect },
  version: { select: { versionNumber: true } },
} satisfies Prisma.ContractSignerSelect;

export const signingService = {
  async list(user: AuthUser, contractId: string) {
    const contract = await findVisibleOrThrow(user, contractId);
    const version = await approvedVersion(prisma, contract);
    if (!version) return { versionNumber: null, contentHash: null, signers: [] };
    const signers = await prisma.contractSigner.findMany({
      where: { versionId: version.id },
      select: signerSelect,
      orderBy: [{ signingOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const turn = currentTurn(signers);
    return {
      versionNumber: version.versionNumber,
      contentHash: version.contentHash,
      signers: signers.map((s) => ({
        ...s,
        isMe: s.userId === user.id,
        canSign: contract.status === 'APPROVED' && s.userId === user.id && s.status === 'PENDING' && s.signingOrder === turn,
      })),
    };
  },

  /** People who may be chosen as internal signers (their role holds contract.sign). */
  async eligibleInternalSigners() {
    const roles = (['ADMIN', 'LEGAL', 'MANAGER', 'FINANCE', 'EMPLOYEE'] as const).filter((r) =>
      hasPermission(r, Permission.CONTRACT_SIGN),
    );
    return prisma.user.findMany({
      where: { isActive: true, role: { in: [...roles] } },
      select: { id: true, firstName: true, lastName: true, email: true, role: true, department: { select: { name: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  },

  /**
   * Sets (or replaces) the signers of an approved contract. Allowed only until
   * the first signature: after that, the list is part of the evidence.
   */
  async setSigners(user: AuthUser, contractId: string, body: SignersBody) {
    const visible = await findVisibleOrThrow(user, contractId);
    if (user.role !== 'ADMIN' && visible.ownerId !== user.id) {
      throw new ForbiddenError('Only the contract owner or an admin can choose signers');
    }

    await prisma.$transaction(async (tx) => {
      const contract = await lockContract(tx, contractId);
      if (contract.status !== 'APPROVED') throw new ConflictError('Signers can only be set on an approved contract');
      const version = (await approvedVersion(tx, contract))!;
      if (await tx.contractSigner.count({ where: { versionId: version.id, status: 'SIGNED' } })) {
        throw new ConflictError('Someone has already signed; the signer list can no longer change');
      }

      const internalIds = body.signers.flatMap((s) => ('userId' in s ? [s.userId] : []));
      const users = await tx.user.findMany({
        where: { id: { in: internalIds }, isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      });
      const rows: (Prisma.ContractSignerCreateManyInput & { rawToken?: string })[] = [];
      for (const s of body.signers) {
        if ('userId' in s) {
          const u = users.find((x) => x.id === s.userId);
          if (!u) throw new BadRequestError('Unknown or inactive user among the signers');
          if (!hasPermission(u.role, Permission.CONTRACT_SIGN)) {
            throw new BadRequestError(`${u.firstName} ${u.lastName} (${u.role}) is not allowed to sign contracts`);
          }
          rows.push({ contractId, versionId: version.id, userId: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email, signingOrder: s.signingOrder });
        } else {
          const rawToken = randomBytes(32).toString('base64url');
          rows.push({
            contractId,
            versionId: version.id,
            name: s.name,
            email: s.email,
            signingOrder: s.signingOrder,
            accessTokenHash: sha256Hex(rawToken),
            accessTokenExpiresAt: new Date(Date.now() + LINK_TTL_DAYS * 86_400_000),
            rawToken,
          });
        }
      }
      if (new Set(rows.map((r) => r.email)).size !== rows.length) throw new BadRequestError('Each signer must have a different email');

      await tx.contractSigner.deleteMany({ where: { versionId: version.id } });
      await tx.contractSigner.createMany({ data: rows.map(({ rawToken: _, ...r }) => r) });
      await recordAudit(
        {
          action: 'CONTRACT_UPDATED',
          entityType: 'contract',
          entityId: contractId,
          contractId,
          metadata: { signers: rows.map((r) => ({ name: r.name, email: r.email, order: r.signingOrder ?? 1, internal: !!r.userId })) },
        },
        tx,
      );
      // External links exist only now, in memory; remember them to email the first group.
      const tokens = new Map(rows.filter((r) => r.rawToken).map((r) => [r.email, r.rawToken!]));
      await requestNextSignatures(tx, contract, version.id, tokens);
    });
    return this.list(user, contractId);
  },

  async signAsUser(user: AuthUser, contractId: string, body: SignBody) {
    await findVisibleOrThrow(user, contractId);
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const version = await approvedVersion(prisma, contract);
    const signer = version
      ? await prisma.contractSigner.findFirst({ where: { versionId: version.id, userId: user.id } })
      : null;
    if (!signer) throw new ForbiddenError('You are not a signer of this contract');
    await sign(signer, body, user.id);
    return this.list(user, contractId);
  },

  async declineAsUser(user: AuthUser, contractId: string, reason: string) {
    await findVisibleOrThrow(user, contractId);
    const signer = await prisma.contractSigner.findFirst({
      where: { contractId, userId: user.id, status: 'PENDING', contract: { status: 'APPROVED' } },
    });
    if (!signer) throw new ForbiddenError('You have no pending signature on this contract');
    await decline(signer, reason, user.id);
    return this.list(user, contractId);
  },

  // --- external signers (token links) -------------------------------------

  async viewByToken(token: string) {
    const signer = await signerByToken(token);
    const contract = await prisma.contract.findUniqueOrThrow({
      where: { id: signer.contractId },
      select: { id: true, referenceNumber: true, status: true, owner: { select: { firstName: true, lastName: true, email: true } } },
    });
    const version = await prisma.contractVersion.findUniqueOrThrow({ where: { id: signer.versionId }, select: { versionNumber: true } });
    const content = await contractRepository.findVersion(signer.contractId, version.versionNumber);
    const signers = await prisma.contractSigner.findMany({
      where: { versionId: signer.versionId },
      select: { name: true, signingOrder: true, status: true, signedAt: true },
      orderBy: { signingOrder: 'asc' },
    });
    const turn = currentTurn(signers);
    return {
      signer: { name: signer.name, email: signer.email, status: signer.status, signingOrder: signer.signingOrder },
      canSign: contract.status === 'APPROVED' && signer.status === 'PENDING' && signer.signingOrder === turn,
      contract: { referenceNumber: contract.referenceNumber, status: contract.status, owner: contract.owner },
      version: content,
      signers,
    };
  },

  async openDocumentByToken(token: string) {
    const signer = await signerByToken(token);
    const version = await prisma.contractVersion.findUniqueOrThrow({ where: { id: signer.versionId }, select: { file: true } });
    if (!version.file) throw new NotFoundError('Document');
    await recordAudit({
      action: 'DOCUMENT_DOWNLOADED',
      entityType: 'file',
      entityId: version.file.id,
      contractId: signer.contractId,
      userId: null,
      metadata: { externalSigner: signer.email },
    });
    return { file: version.file, stream: fileService.open(version.file.storageKey) };
  },

  async signByToken(token: string, body: SignBody) {
    await sign(await signerByToken(token), body, null);
    return this.viewByToken(token);
  },

  async declineByToken(token: string, reason: string) {
    await decline(await signerByToken(token), reason, null);
    return this.viewByToken(token);
  },

  /** Scheduler: SIGNED contracts whose start date has arrived become ACTIVE. */
  async activateDueContracts(now = new Date()): Promise<{ activated: number }> {
    const due = await prisma.contract.findMany({
      where: { status: 'SIGNED', startDate: { lte: now } },
      select: { id: true },
      take: 200,
    });
    let activated = 0;
    for (const { id } of due) {
      try {
        await prisma.$transaction(async (tx) => {
          await transitionContract(tx, { contractId: id, from: 'SIGNED', to: 'ACTIVE', actorId: null, reason: 'Start date reached', data: { activatedAt: now } });
          await recordAudit({ action: 'CONTRACT_ACTIVATED', entityType: 'contract', entityId: id, contractId: id, userId: null }, tx);
        });
        activated++;
      } catch (err) {
        logger.warn({ err, contractId: id }, 'Could not activate contract');
      }
    }
    return { activated };
  },
};

// -----------------------------------------------------------------------------
//  Helpers
// -----------------------------------------------------------------------------

async function lockContract(tx: DbClient, contractId: string): Promise<Contract> {
  await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
  return tx.contract.findUniqueOrThrow({ where: { id: contractId } });
}

/** The version covered by the latest approval; that is what gets signed. */
async function approvedVersion(db: DbClient, contract: Contract) {
  if (!['APPROVED', 'SIGNED', 'ACTIVE', 'EXPIRED', 'RENEWED', 'TERMINATED'].includes(contract.status)) return null;
  const request = await db.approvalRequest.findFirst({
    where: { contractId: contract.id, status: 'APPROVED' },
    orderBy: { completedAt: 'desc' },
    select: { contractVersion: { select: { id: true, versionNumber: true, contentHash: true } } },
  });
  return request?.contractVersion ?? null;
}

/** The signing order currently "up": the lowest order that still has pending signers. */
function currentTurn(signers: { status: string; signingOrder: number }[]): number | null {
  const pending = signers.filter((s) => s.status === 'PENDING').map((s) => s.signingOrder);
  return pending.length ? Math.min(...pending) : null;
}

/** Generic on purpose: a wrong, used or expired link all look the same. */
async function signerByToken(token: string): Promise<ContractSigner> {
  const signer = await prisma.contractSigner.findUnique({ where: { accessTokenHash: sha256Hex(token) } });
  if (!signer || !signer.accessTokenExpiresAt || signer.accessTokenExpiresAt < new Date()) {
    throw new NotFoundError('Signing link (it may have expired)');
  }
  return signer;
}

/** Decodes and checks the drawn signature: it must really be a PNG. */
function decodeSignatureImage(dataUrl: string) {
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 100 || !PNG.every((b, i) => buffer[i] === b)) throw new BadRequestError('Invalid signature image');
  return { buffer, originalName: 'signature.png', mimeType: 'image/png' };
}

async function sign(signer: ContractSigner, body: SignBody, actorUserId: string | null) {
  const image = body.method === 'DRAWN' ? decodeSignatureImage(body.signatureImage!) : null;
  const contractOwner = (await prisma.contract.findUniqueOrThrow({ where: { id: signer.contractId }, select: { ownerId: true } })).ownerId;
  const ctx = getRequestContext();

  // StoredFile needs an uploader; an external signer has no account, so their
  // drawn signature is filed under the contract owner (the signer row holds the real evidence).
  await fileService.withStoredUpload(image, actorUserId ?? contractOwner, (saveFile) =>
    prisma.$transaction(async (tx) => {
      const contract = await lockContract(tx, signer.contractId);
      if (contract.status !== 'APPROVED') throw new ConflictError(`This contract is ${contract.status} and can't be signed`);
      const fresh = await tx.contractSigner.findUniqueOrThrow({ where: { id: signer.id } });
      if (fresh.status !== 'PENDING') throw new ConflictError(`You have already ${fresh.status === 'SIGNED' ? 'signed' : 'declined'}`);
      const all = await tx.contractSigner.findMany({ where: { versionId: signer.versionId } });
      if (fresh.signingOrder !== currentTurn(all)) throw new ConflictError('Earlier signers must sign first');
      const version = await tx.contractVersion.findUniqueOrThrow({ where: { id: signer.versionId }, select: { contentHash: true } });
      if (body.contentHash !== version.contentHash) {
        throw new ConflictError('The contract changed since you opened it. Reload and review it again before signing.');
      }

      const file = saveFile ? await saveFile(tx) : null;
      const now = new Date();
      const { count } = await tx.contractSigner.updateMany({
        where: { id: signer.id, status: 'PENDING' },
        data: {
          status: 'SIGNED',
          method: body.method,
          typedSignature: body.method === 'TYPED' ? body.typedName : null,
          signatureFileId: file?.id ?? null,
          signedContentHash: version.contentHash,
          signedAt: now,
          ipAddress: ctx?.ip,
          userAgent: ctx?.userAgent,
          // The link stays valid for viewing the confirmation; it can't sign
          // again because the update above only matches a PENDING signer.
        },
      });
      if (count !== 1) throw new ConflictError('This signature was already recorded');
      await recordAudit(
        {
          action: 'CONTRACT_SIGNED',
          entityType: 'signer',
          entityId: signer.id,
          contractId: contract.id,
          userId: actorUserId,
          metadata: { signer: signer.email, method: body.method, contentHash: version.contentHash },
        },
        tx,
      );

      const remaining = all.filter((s) => s.id !== signer.id && s.status === 'PENDING');
      if (remaining.length === 0) {
        const startsLater = contract.startDate !== null && contract.startDate > now;
        await transitionContract(tx, {
          contractId: contract.id,
          from: 'APPROVED',
          to: startsLater ? 'SIGNED' : 'ACTIVE',
          actorId: actorUserId,
          reason: 'All parties signed',
          data: startsLater ? undefined : { activatedAt: now },
        });
        if (!startsLater) {
          await recordAudit({ action: 'CONTRACT_ACTIVATED', entityType: 'contract', entityId: contract.id, contractId: contract.id, userId: actorUserId }, tx);
        }
        await notify(tx, [contract.ownerId], {
          type: 'CONTRACT_SIGNED',
          title: `${contract.referenceNumber} ${contract.title} is fully signed`,
          body: startsLater ? `All parties signed. It becomes active on ${contract.startDate!.toISOString().slice(0, 10)}.` : 'All parties signed. The contract is now active.',
          contractId: contract.id,
          link: contractLink(contract.id, 'signatures'),
        });
      } else {
        await requestNextSignatures(tx, contract, signer.versionId, new Map());
      }
    }),
  );
}

async function decline(signer: ContractSigner, reason: string, actorUserId: string | null) {
  await prisma.$transaction(async (tx) => {
    const contract = await lockContract(tx, signer.contractId);
    if (contract.status !== 'APPROVED') throw new ConflictError(`This contract is ${contract.status}`);
    const { count } = await tx.contractSigner.updateMany({
      where: { id: signer.id, status: 'PENDING' },
      data: { status: 'DECLINED', declineReason: reason },
    });
    if (count !== 1) throw new ConflictError('This signer has already responded');
    await transitionContract(tx, {
      contractId: contract.id,
      from: 'APPROVED',
      to: 'DRAFT',
      actorId: actorUserId,
      reason: `Signature declined by ${signer.name}: ${reason}`,
    });
    await recordAudit(
      { action: 'CONTRACT_REOPENED', entityType: 'signer', entityId: signer.id, contractId: contract.id, userId: actorUserId, metadata: { declinedBy: signer.email, reason } },
      tx,
    );
    await notify(tx, [contract.ownerId], {
      type: 'CONTRACT_REJECTED',
      title: `${contract.referenceNumber} ${contract.title}: signature declined`,
      body: `${signer.name} declined to sign: ${reason}. The contract is back in draft.`,
      contractId: contract.id,
      link: contractLink(contract.id, 'signatures'),
    });
  });
}

/**
 * Notifies the signers whose turn it now is. Internal signers get an in-app
 * notification (plus email); external signers get an email with their link.
 * An external link is only known right after it's generated, so later groups
 * of external signers get a fresh link when their turn comes.
 */
async function requestNextSignatures(tx: DbClient, contract: Contract, versionId: string, tokens: Map<string, string>) {
  const all = await tx.contractSigner.findMany({ where: { versionId } });
  const turn = currentTurn(all);
  if (turn === null) return;
  for (const s of all.filter((x) => x.status === 'PENDING' && x.signingOrder === turn)) {
    if (s.userId) {
      await notify(tx, [s.userId], {
        type: 'SIGNATURE_REQUESTED',
        title: `Signature needed: ${contract.referenceNumber} ${contract.title}`,
        body: 'The contract is approved and waiting for your signature.',
        contractId: contract.id,
        link: contractLink(contract.id, 'signatures'),
        dedupeKey: `signature-requested:${s.id}`,
      });
      continue;
    }
    let token = tokens.get(s.email);
    if (!token) {
      token = randomBytes(32).toString('base64url');
      await tx.contractSigner.update({
        where: { id: s.id },
        data: { accessTokenHash: sha256Hex(token), accessTokenExpiresAt: new Date(Date.now() + LINK_TTL_DAYS * 86_400_000) },
      });
    }
    await tx.job.createMany({
      data: [
        {
          type: 'email.send',
          payload: {
            to: s.email,
            subject: `Please sign: ${contract.title}`,
            text: `Hello ${s.name},\n\n${contract.title} (${contract.referenceNumber}) is ready for your signature. The link is personal and valid for ${LINK_TTL_DAYS} days.`,
            link: `/sign/${token}`,
          },
          dedupeKey: `signature-link:${s.id}:${sha256Hex(token).slice(0, 16)}`,
        },
      ],
      skipDuplicates: true,
    });
  }
}
