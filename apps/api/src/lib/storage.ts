import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';

/**
 * Where file bytes live. Callers only ever see an opaque `storageKey`; the
 * provider decides what it means (a relative path on disk today, an S3 object
 * key tomorrow). Adding S3 is one new class plus a STORAGE_DRIVER value.
 */
export interface StorageProvider {
  put(content: Buffer): Promise<StoredObject>;
  get(storageKey: string): Readable;
  delete(storageKey: string): Promise<void>;
}

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
}

export function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Stores files under `<root>/<yyyy>/<mm>/<uuid>`. Keys are generated here, never
 * derived from the uploaded file name, so a crafted name can't escape the root;
 * `resolve` checks it anyway for keys read back from the database.
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async put(content: Buffer): Promise<StoredObject> {
    const now = new Date();
    const storageKey = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      randomUUID(),
    ].join('/');
    const target = this.resolve(storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    // `wx`: never overwrite an existing object.
    await writeFile(target, content, { flag: 'wx' });
    return { storageKey, sizeBytes: content.length, sha256: sha256Hex(content) };
  }

  get(storageKey: string): Readable {
    return createReadStream(this.resolve(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolve(storageKey), { force: true });
  }

  private resolve(storageKey: string): string {
    const target = path.resolve(this.root, storageKey);
    if (!target.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${storageKey}`);
    return target;
  }
}

export const storage: StorageProvider = new LocalStorageProvider(env.STORAGE_LOCAL_ROOT);
