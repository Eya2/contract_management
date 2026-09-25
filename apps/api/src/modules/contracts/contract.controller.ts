import type { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { currentUser } from '../../common/middleware/authenticate.js';
import {
  ATTACHMENT_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  jsonBody,
  validateUpload,
} from '../../common/middleware/upload.js';
import {
  AttachmentBody,
  AttachmentParams,
  CreateContractBody,
  DiffQuery,
  IdParams,
  ListContractsQuery,
  UpdateContractBody,
  VersionParams,
} from './contract.schemas.js';
import { contractService } from './contract.service.js';

/** The optional contract document sent as the `document` part of a multipart request. */
function optionalDocument(req: Request) {
  return req.file ? validateUpload(req.file, DOCUMENT_EXTENSIONS) : null;
}

/** Streams a stored file as a download. `nosniff` (set by helmet) stops the browser second-guessing the type. */
function sendFile(res: Response, file: { originalName: string; mimeType: string; sizeBytes: number }, stream: Readable) {
  res.attachment(file.originalName);
  res.type(file.mimeType);
  res.setHeader('Content-Length', file.sizeBytes);
  res.setHeader('Cache-Control', 'private, no-store');
  stream.on('error', (err) => res.destroy(err));
  stream.pipe(res);
}

export const contractController = {
  async list(req: Request, res: Response) {
    res.json(await contractService.list(currentUser(req), ListContractsQuery.parse(req.query)));
  },

  async get(req: Request, res: Response) {
    const { id } = IdParams.parse(req.params);
    res.json(await contractService.get(currentUser(req), id));
  },

  async create(req: Request, res: Response) {
    const body = CreateContractBody.parse(jsonBody(req));
    res.status(201).json(await contractService.create(currentUser(req), body, optionalDocument(req)));
  },

  async update(req: Request, res: Response) {
    const { id } = IdParams.parse(req.params);
    const body = UpdateContractBody.parse(jsonBody(req));
    res.json(await contractService.update(currentUser(req), id, body, optionalDocument(req)));
  },

  async listVersions(req: Request, res: Response) {
    const { id } = IdParams.parse(req.params);
    res.json(await contractService.listVersions(currentUser(req), id));
  },

  async getVersion(req: Request, res: Response) {
    const { id, versionNumber } = VersionParams.parse(req.params);
    res.json(await contractService.getVersion(currentUser(req), id, versionNumber));
  },

  async diff(req: Request, res: Response) {
    const { id } = IdParams.parse(req.params);
    const { from, to } = DiffQuery.parse(req.query);
    res.json(await contractService.diff(currentUser(req), id, from, to));
  },

  async timeline(req: Request, res: Response) {
    const { id } = IdParams.parse(req.params);
    res.json(await contractService.timeline(currentUser(req), id));
  },

  async downloadDocument(req: Request, res: Response) {
    const { id, versionNumber } = VersionParams.parse(req.params);
    const { file, stream } = await contractService.openDocument(currentUser(req), id, versionNumber);
    sendFile(res, file, stream);
  },

  async addAttachment(req: Request, res: Response) {
    const { id } = IdParams.parse(req.params);
    const body = AttachmentBody.parse(req.body ?? {});
    const upload = validateUpload(req.file, ATTACHMENT_EXTENSIONS);
    res.status(201).json(await contractService.addAttachment(currentUser(req), id, body, upload));
  },

  async removeAttachment(req: Request, res: Response) {
    const { id, attachmentId } = AttachmentParams.parse(req.params);
    await contractService.removeAttachment(currentUser(req), id, attachmentId);
    res.status(204).end();
  },

  async downloadAttachment(req: Request, res: Response) {
    const { id, attachmentId } = AttachmentParams.parse(req.params);
    const { file, stream } = await contractService.openAttachment(currentUser(req), id, attachmentId);
    sendFile(res, file, stream);
  },
};
