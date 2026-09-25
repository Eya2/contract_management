import { Router, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, currentUser, requirePermission } from '../../common/middleware/authenticate.js';
import { VersionParams } from '../contracts/contract.schemas.js';
import { TokenParams } from '../signing/signing.schemas.js';
import { documentService } from './document.service.js';

const LangQuery = z.object({
  lang: z.enum(['en', 'fr']).default('en'),
  /** `download=1` saves the file; by default it opens inline, for preview. */
  download: z.enum(['0', '1']).default('0'),
});

function sendPdf(res: Response, pdf: Buffer, fileName: string, download: boolean) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}

/** Mounted under /api/contracts. */
export const contractPdfRouter = Router();
contractPdfRouter.get('/:id/versions/:versionNumber/pdf', authenticate, requirePermission(Permission.CONTRACT_READ), async (req, res) => {
  const { id, versionNumber } = VersionParams.parse(req.params);
  const { lang, download } = LangQuery.parse(req.query);
  const { pdf, fileName } = await documentService.versionPdf(currentUser(req), id, versionNumber, lang);
  sendPdf(res, pdf, fileName, download === '1');
});

/** Mounted under /api/signing: the external signer's view of the contract. */
export const signerPdfRouter = Router();
signerPdfRouter.get('/:token/pdf', async (req, res) => {
  const { token } = TokenParams.parse(req.params);
  const { lang, download } = LangQuery.parse(req.query);
  const { pdf, fileName } = await documentService.signerPdf(token, lang);
  sendPdf(res, pdf, fileName, download === '1');
});
