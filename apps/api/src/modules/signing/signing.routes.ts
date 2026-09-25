import type { Readable } from 'node:stream';
import { Router, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { Permission } from '../../common/auth/permissions.js';
import { authenticate, currentUser, requirePermission } from '../../common/middleware/authenticate.js';
import { IdParams } from '../contracts/contract.schemas.js';
import { DeclineBody, SignBody, SignersBody, TokenParams } from './signing.schemas.js';
import { signingService } from './signing.service.js';

/** Signing by signed-in users, mounted under /api/contracts. */
export const contractSigningRouter = Router();
contractSigningRouter.use(authenticate);

contractSigningRouter.get('/:id/signers', requirePermission(Permission.CONTRACT_READ), async (req, res) => {
  res.json(await signingService.list(currentUser(req), IdParams.parse(req.params).id));
});
contractSigningRouter.put('/:id/signers', requirePermission(Permission.CONTRACT_UPDATE), async (req, res) => {
  res.json(await signingService.setSigners(currentUser(req), IdParams.parse(req.params).id, SignersBody.parse(req.body)));
});
// Being listed as a signer is what authorizes signing (and only contract.sign roles can be listed).
contractSigningRouter.post('/:id/sign', async (req, res) => {
  res.json(await signingService.signAsUser(currentUser(req), IdParams.parse(req.params).id, SignBody.parse(req.body)));
});
contractSigningRouter.post('/:id/decline-signature', async (req, res) => {
  const { reason } = DeclineBody.parse(req.body);
  res.json(await signingService.declineAsUser(currentUser(req), IdParams.parse(req.params).id, reason));
});

/** Candidates for the internal-signer picker. */
export const signersRouter = Router();
signersRouter.get('/', authenticate, requirePermission(Permission.CONTRACT_UPDATE), async (_req, res) => {
  res.json(await signingService.eligibleInternalSigners());
});

/**
 * Public signing links for external signers: /api/signing/:token. The token is
 * the credential, so these routes are rate-limited against guessing (a 256-bit
 * token can't be guessed, but the limit also stops hammering).
 */
export const publicSigningRouter = Router();
publicSigningRouter.use(
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, try again in a minute' } },
  }),
);

publicSigningRouter.get('/:token', async (req, res) => {
  res.json(await signingService.viewByToken(TokenParams.parse(req.params).token));
});
publicSigningRouter.get('/:token/document', async (req, res) => {
  const { file, stream } = await signingService.openDocumentByToken(TokenParams.parse(req.params).token);
  sendFile(res, file, stream);
});
publicSigningRouter.post('/:token/sign', async (req, res) => {
  res.json(await signingService.signByToken(TokenParams.parse(req.params).token, SignBody.parse(req.body)));
});
publicSigningRouter.post('/:token/decline', async (req, res) => {
  const { reason } = DeclineBody.parse(req.body);
  res.json(await signingService.declineByToken(TokenParams.parse(req.params).token, reason));
});

function sendFile(res: Response, file: { originalName: string; mimeType: string; sizeBytes: number }, stream: Readable) {
  res.attachment(file.originalName);
  res.type(file.mimeType);
  res.setHeader('Content-Length', file.sizeBytes);
  res.setHeader('Cache-Control', 'private, no-store');
  stream.on('error', (err) => res.destroy(err));
  stream.pipe(res);
}
