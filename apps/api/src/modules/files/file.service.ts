import type { Readable } from 'node:stream';
import type { ValidatedUpload } from '../../common/middleware/upload.js';
import { logger } from '../../lib/logger.js';
import type { DbClient } from '../../lib/prisma.js';
import { storage } from '../../lib/storage.js';

/** Public metadata of a stored file (never the storage key). */
export const storedFileSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  createdAt: true,
} as const;

export const fileService = {
  /**
   * Writes the bytes to storage, then runs `fn` (normally a DB transaction that
   * records the file). If `fn` fails, the bytes are removed again, so a
   * rolled-back transaction doesn't leave an orphan blob behind.
   *
   * With no upload, `fn` just runs with `null`.
   */
  async withStoredUpload<T>(
    upload: ValidatedUpload | null,
    uploadedById: string,
    fn: (record: ((db: DbClient) => Promise<{ id: string; sha256: string }>) | null) => Promise<T>,
  ): Promise<T> {
    if (!upload) return fn(null);
    const blob = await storage.put(upload.buffer);
    const record = (db: DbClient) =>
      db.storedFile.create({
        data: {
          storageKey: blob.storageKey,
          originalName: upload.originalName,
          mimeType: upload.mimeType,
          sizeBytes: blob.sizeBytes,
          sha256: blob.sha256,
          uploadedById,
        },
        select: { id: true, sha256: true },
      });
    try {
      return await fn(record);
    } catch (err) {
      await storage.delete(blob.storageKey).catch((e) => logger.warn({ err: e }, 'Could not remove orphan upload'));
      throw err;
    }
  },

  open(storageKey: string): Readable {
    return storage.get(storageKey);
  },
};
