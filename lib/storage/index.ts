import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface StoredObject {
  key: string;
  bytes: number;
}

export interface StorageDriver {
  put(key: string, data: Buffer | Readable): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  createReadStream(key: string, range?: { start: number; end: number }): Readable;
  stat(key: string): Promise<{ bytes: number } | null>;
  delete(key: string): Promise<void>;
  /** Public URL for a key. Local driver routes through an app handler. */
  url(key: string): string;
}

/**
 * Keys are app-generated (`media/<id>/original.jpg`), never user-supplied — but
 * they do reach the filesystem via a URL path segment in the file handler, so
 * every key is validated before it is joined to the storage root.
 */
const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

export function isSafeKey(key: string): boolean {
  if (!key || key.length > 400) return false;
  if (!KEY_RE.test(key)) return false;
  // Reject traversal and absolute-ish forms before they reach path.join.
  if (key.includes("..")) return false;
  if (key.includes("//")) return false;
  if (key.startsWith("/")) return false;
  return true;
}

class LocalDiskDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!isSafeKey(key)) {
      throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
    }
    const full = path.resolve(this.root, key);
    // Belt and braces: even with a validated key, confirm we stayed inside root.
    const rootWithSep = path.resolve(this.root) + path.sep;
    if (!full.startsWith(rootWithSep)) {
      throw new Error(`Storage key escaped root: ${JSON.stringify(key)}`);
    }
    return full;
  }

  async put(key: string, data: Buffer | Readable): Promise<StoredObject> {
    const full = this.resolve(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });

    if (Buffer.isBuffer(data)) {
      await fsp.writeFile(full, data);
    } else {
      await pipeline(data, fs.createWriteStream(full));
    }

    const stat = await fsp.stat(full);
    return { key, bytes: stat.size };
  }

  async get(key: string): Promise<Buffer> {
    return fsp.readFile(this.resolve(key));
  }

  createReadStream(key: string, range?: { start: number; end: number }) {
    return fs.createReadStream(this.resolve(key), range);
  }

  async stat(key: string) {
    try {
      const s = await fsp.stat(this.resolve(key));
      return { bytes: s.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await fsp.rm(this.resolve(key), { force: true });
  }

  url(key: string): string {
    return `/api/files/${key}`;
  }
}

/**
 * Placeholder for the eventual S3/R2 move. Implementing this class and flipping
 * STORAGE_DRIVER is the entire migration — nothing above this interface knows
 * where bytes physically live.
 */
class S3Driver implements StorageDriver {
  private fail(): never {
    throw new Error(
      "S3 storage driver is not implemented yet. Unset STORAGE_DRIVER to use local disk.",
    );
  }
  put(): Promise<StoredObject> {
    this.fail();
  }
  get(): Promise<Buffer> {
    this.fail();
  }
  createReadStream(): Readable {
    this.fail();
  }
  stat(): Promise<{ bytes: number } | null> {
    this.fail();
  }
  delete(): Promise<void> {
    this.fail();
  }
  url(): string {
    this.fail();
  }
}

const STORAGE_ROOT =
  process.env.STORAGE_ROOT ?? path.join(process.cwd(), ".data", "media");

export const storage: StorageDriver =
  process.env.STORAGE_DRIVER === "s3"
    ? new S3Driver()
    : new LocalDiskDriver(STORAGE_ROOT);

export { STORAGE_ROOT };
