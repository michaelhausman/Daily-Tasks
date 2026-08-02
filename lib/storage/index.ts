import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { contentTypeForKey } from "./mime";

export interface StoredObject {
  key: string;
  bytes: number;
}

export interface StorageDriver {
  put(key: string, data: Buffer | Readable, contentType?: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  createReadStream(
    key: string,
    range?: { start: number; end: number },
  ): Readable | Promise<Readable>;
  stat(key: string): Promise<{ bytes: number } | null>;
  delete(key: string): Promise<void>;
  /** Browser-facing URL for a key. */
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

/**
 * Optional CDN or public-bucket origin. When set, media URLs point straight at
 * it and the app stops proxying bytes entirely — which is what you want in
 * production, since a Next.js server is an expensive way to serve a video.
 * Leave unset and everything routes through `/api/files/`.
 */
const PUBLIC_BASE = process.env.MEDIA_PUBLIC_BASE_URL?.replace(/\/+$/, "");

function publicUrl(key: string): string {
  return PUBLIC_BASE ? `${PUBLIC_BASE}/${key}` : `/api/files/${key}`;
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
    return publicUrl(key);
  }
}

/**
 * S3-compatible object storage: AWS S3, Cloudflare R2, Backblaze B2, MinIO.
 *
 * The only differences between them are the endpoint and whether the bucket is
 * addressed path-style, both of which are environment configuration. R2 in
 * particular is worth the default recommendation for a media site because it
 * charges nothing for egress, and for video, bandwidth — not storage — is what
 * dominates the bill.
 */
class S3Driver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    const missing = [
      !bucket && "S3_BUCKET",
      !accessKeyId && "S3_ACCESS_KEY_ID",
      !secretAccessKey && "S3_SECRET_ACCESS_KEY",
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new Error(
        `STORAGE_DRIVER=s3 requires: ${missing.join(", ")}. ` +
          `See .env.example for the full list.`,
      );
    }

    this.bucket = bucket!;
    this.client = new S3Client({
      // R2 ignores region but the SDK insists on one; "auto" is what
      // Cloudflare's own docs use.
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT,
      // MinIO and some self-hosted gateways need path-style addressing.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
    });
  }

  async put(
    key: string,
    data: Buffer | Readable,
    contentType?: string,
  ): Promise<StoredObject> {
    if (!isSafeKey(key)) {
      throw new Error(`Unsafe storage key: ${JSON.stringify(key)}`);
    }

    // A stream of unknown length can't be signed without buffering, and every
    // caller already has the bytes in memory, so normalize to a Buffer.
    const body = Buffer.isBuffer(data) ? data : await streamToBuffer(data);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        // Falling back to the key's extension means every derivative gets a
        // correct type without each call site having to remember to pass one —
        // and a wrong Content-Type here is invisible until a browser refuses
        // to play a video served as application/octet-stream.
        ContentType: contentType ?? contentTypeForKey(key),
        // Media is immutable once written — the key contains the media id and
        // is never rewritten in place.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    return { key, bytes: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return streamToBuffer(out.Body as Readable);
  }

  async createReadStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<Readable> {
    const out = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    return out.Body as Readable;
  }

  async stat(key: string) {
    if (!isSafeKey(key)) return null;
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { bytes: out.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  url(key: string): string {
    return publicUrl(key);
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const STORAGE_ROOT =
  process.env.STORAGE_ROOT ?? path.join(process.cwd(), ".data", "media");

function createStorage(): StorageDriver {
  if (process.env.STORAGE_DRIVER === "s3") return new S3Driver();
  return new LocalDiskDriver(STORAGE_ROOT);
}

// Same hot-reload guard as the database client: a new S3Client per reload leaks
// sockets until the dev server runs out of handles.
const globalForStorage = globalThis as unknown as {
  __tagpoolStorage?: StorageDriver;
};

export const storage: StorageDriver =
  globalForStorage.__tagpoolStorage ?? createStorage();

if (process.env.NODE_ENV !== "production") {
  globalForStorage.__tagpoolStorage = storage;
}

export function describeStorage(): string {
  return process.env.STORAGE_DRIVER === "s3"
    ? `S3-compatible bucket "${process.env.S3_BUCKET}"${
        process.env.S3_ENDPOINT ? ` at ${process.env.S3_ENDPOINT}` : ""
      }`
    : `local disk at ${STORAGE_ROOT}`;
}

export { STORAGE_ROOT };
