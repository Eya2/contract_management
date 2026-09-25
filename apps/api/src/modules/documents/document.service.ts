import type { Readable } from 'node:stream';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { NotFoundError } from '../../common/errors/app-error.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { storage, sha256Hex } from '../../lib/storage.js';
import { findVisibleOrThrow } from '../contracts/contract.service.js';
import { renderContractPdf, type PdfLang } from './contract-pdf.js';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Builds the PDF of one contract version, with the signatures collected on it
 * so far. Rendered on demand: the version is immutable, so the same version
 * always renders the same terms, and signatures appear as soon as they exist.
 */
export const documentService = {
  async versionPdf(user: AuthUser, contractId: string, versionNumber: number, lang: PdfLang): Promise<{ pdf: Buffer; fileName: string }> {
    await findVisibleOrThrow(user, contractId);
    return render(contractId, versionNumber, lang);
  },

  /** For an external signer's link: the version they are asked to sign. */
  async signerPdf(token: string, lang: PdfLang): Promise<{ pdf: Buffer; fileName: string }> {
    const signer = await prisma.contractSigner.findUnique({ where: { accessTokenHash: sha256Hex(token) } });
    if (!signer || !signer.accessTokenExpiresAt || signer.accessTokenExpiresAt < new Date()) {
      throw new NotFoundError('Signing link (it may have expired)');
    }
    const version = await prisma.contractVersion.findUniqueOrThrow({ where: { id: signer.versionId }, select: { versionNumber: true } });
    return render(signer.contractId, version.versionNumber, lang);
  },
};

async function render(contractId: string, versionNumber: number, lang: PdfLang) {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: { owner: true, department: true },
  });
  const version = await prisma.contractVersion.findUnique({
    where: { contractId_versionNumber: { contractId, versionNumber } },
    include: {
      counterparty: true,
      file: true,
      clauses: { orderBy: { position: 'asc' } },
      signers: { include: { signatureFile: true }, orderBy: [{ signingOrder: 'asc' }, { createdAt: 'asc' }] },
      approvalRequests: {
        where: { status: 'APPROVED' },
        include: { steps: { where: { status: 'APPROVED' }, include: { decidedBy: true }, orderBy: [{ stage: 'asc' }, { decidedAt: 'asc' }] } },
      },
    },
  });
  if (!version) throw new NotFoundError('Version');

  // The contract's current status only describes the current version; older
  // versions are always shown as drafts that were superseded.
  const status = versionNumber === contract.currentVersionNumber ? contract.status : 'DRAFT';
  const signers = await Promise.all(
    version.signers.map(async (s) => ({
      name: s.name,
      email: s.email,
      internal: !!s.userId,
      order: s.signingOrder,
      status: s.status,
      method: s.method,
      typedSignature: s.typedSignature,
      signatureImage: s.signatureFile ? await readAll(storage.get(s.signatureFile.storageKey)).catch(() => null) : null,
      signedAt: s.signedAt,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      signedContentHash: s.signedContentHash,
    })),
  );

  const pdf = await renderContractPdf({
    lang,
    company: env.COMPANY_NAME,
    reference: contract.referenceNumber,
    title: version.title,
    type: version.type,
    status,
    versionNumber,
    contentHash: version.contentHash,
    generatedAt: new Date(),
    department: contract.department.name,
    owner: { name: `${contract.owner.firstName} ${contract.owner.lastName}`, email: contract.owner.email },
    counterparty: {
      name: version.counterparty.name,
      email: version.counterparty.email,
      contactName: version.counterparty.contactName,
      registrationNumber: version.counterparty.registrationNumber,
    },
    value: version.value?.toFixed(2) ?? null,
    currency: version.currency,
    startDate: version.startDate,
    endDate: version.endDate,
    autoRenew: contract.autoRenew,
    clauses: version.clauses.map((c) => ({ heading: c.heading, body: c.body })),
    document: version.file ? { name: version.file.originalName, sha256: version.file.sha256 } : null,
    signers,
    approvals: version.approvalRequests.flatMap((r) =>
      r.steps.map((s) => ({ step: s.name, decidedBy: s.decidedBy ? `${s.decidedBy.firstName} ${s.decidedBy.lastName}` : '-', decidedAt: s.decidedAt! })),
    ),
  });
  const signed = version.signers.length > 0 && version.signers.every((s) => s.status === 'SIGNED');
  return { pdf, fileName: `${contract.referenceNumber}-v${versionNumber}${signed ? '-signed' : ''}.pdf` };
}
