import path from 'node:path';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { BadRequestError } from '../errors/app-error.js';

/**
 * File uploads (multipart/form-data), held in memory and capped at
 * MAX_UPLOAD_BYTES: files are hashed and written to storage in one go, and the
 * cap keeps memory use bounded.
 *
 * The browser-supplied MIME type is ignored. The type comes from the extension,
 * which must be on the allowlist, and the leading "magic" bytes must match it,
 * so a renamed executable can't be stored (and later served) as a PDF.
 */

interface FileKind {
  mimeType: string;
  /** Leading bytes the content must start with; absent for plain-text formats. */
  magic?: number[];
}

const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx/xlsx are zip containers
const OLE = [0xd0, 0xcf, 0x11, 0xe0]; // legacy .doc/.xls

const ALLOWED: Record<string, FileKind> = {
  '.pdf': { mimeType: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  '.docx': { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: ZIP },
  '.doc': { mimeType: 'application/msword', magic: OLE },
  '.xlsx': { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: ZIP },
  '.png': { mimeType: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  '.jpg': { mimeType: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  '.jpeg': { mimeType: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  '.txt': { mimeType: 'text/plain' },
  '.csv': { mimeType: 'text/csv' },
};

/** The main contract document: the formats a contract is actually written in. */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.doc'] as const;
/** Supporting attachments: anything on the allowlist. */
export const ATTACHMENT_EXTENSIONS = Object.keys(ALLOWED);

export interface ValidatedUpload {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}

/**
 * Checks an uploaded file against the allowlist and returns its trusted MIME type.
 * Throws a 400 describing what's accepted when it doesn't pass.
 */
export function validateUpload(
  file: Express.Multer.File | undefined,
  allowedExtensions: readonly string[],
): ValidatedUpload {
  if (!file) throw new BadRequestError('A file is required');
  const originalName = path.basename(file.originalname).slice(0, 255);
  const ext = path.extname(originalName).toLowerCase();
  const kind = allowedExtensions.includes(ext) ? ALLOWED[ext] : undefined;
  if (!kind) {
    throw new BadRequestError(`Unsupported file type "${ext || originalName}". Allowed: ${allowedExtensions.join(', ')}`);
  }
  if (file.size === 0) throw new BadRequestError('The file is empty');
  if (kind.magic && !kind.magic.every((byte, i) => file.buffer[i] === byte)) {
    throw new BadRequestError(`The file content is not a valid ${ext} file`);
  }
  return { buffer: file.buffer, originalName, mimeType: kind.mimeType };
}

const multipart = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 20 },
});

/** Accepts at most one file in `field`; requests that aren't multipart pass through untouched. */
export function singleFile(field: string): RequestHandler {
  return multipart.single(field);
}

/**
 * Multipart requests can't carry nested JSON, so structured data travels as a
 * JSON string in a `data` field next to the file. This returns the body to
 * validate, whichever encoding the client used.
 */
export function jsonBody(req: { body: unknown; is(type: string): string | false | null }): unknown {
  if (!req.is('multipart/form-data')) return req.body;
  const raw = (req.body as Record<string, unknown> | undefined)?.data;
  if (raw === undefined) return {};
  if (typeof raw !== 'string') throw new BadRequestError('The "data" field must be a JSON string');
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError('The "data" field is not valid JSON');
  }
}
