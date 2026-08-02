import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { storage } from "@/lib/storage";
import type { MediaKind } from "@/lib/db/schema";
import { extractPosterFrame, extractWaveform, probeAv } from "./probe";

export type ProcessResult = {
  thumbKey: string | null;
  webKey: string | null;
  posterKey: string | null;
  waveform: number[] | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: Date | null;
  lat: number | null;
  lng: number | null;
};

const EMPTY: ProcessResult = {
  thumbKey: null,
  webKey: null,
  posterKey: null,
  waveform: null,
  width: null,
  height: null,
  durationMs: null,
  capturedAt: null,
  lat: null,
  lng: null,
};

export function kindFromMime(mime: string): MediaKind | null {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

/** EXIF stores dates as "2026:07:24 21:14:03" in unspecified local time. */
function parseExifDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = value
    .trim()
    .match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(
    Date.UTC(+y, +mo - 1, +d, +h, +mi, +s),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseGpsCoord(
  value: unknown,
  ref: unknown,
): number | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const [deg, min, sec] = value.map(Number);
  if (![deg, min, sec].every(Number.isFinite)) return null;
  let decimal = deg + min / 60 + sec / 3600;
  if (typeof ref === "string" && /^[SW]$/i.test(ref.trim())) decimal = -decimal;
  return Number.isFinite(decimal) ? decimal : null;
}

async function processImage(
  buffer: Buffer,
  mediaId: string,
): Promise<ProcessResult> {
  const result: ProcessResult = { ...EMPTY };

  // `failOn: "none"` keeps a slightly-corrupt phone photo from failing the whole
  // upload; `limitInputPixels` caps decompression-bomb exposure.
  const image = sharp(buffer, {
    failOn: "none",
    limitInputPixels: 100_000_000,
  });

  const meta = await image.metadata();
  // sharp reports pre-rotation dimensions; swap when EXIF orientation is sideways.
  const sideways = (meta.orientation ?? 1) >= 5;
  result.width = (sideways ? meta.height : meta.width) ?? null;
  result.height = (sideways ? meta.width : meta.height) ?? null;

  if (meta.exif) {
    try {
      // exifr-free minimal parse: sharp surfaces the raw EXIF block, and we only
      // need three fields, so a targeted scan beats another dependency.
      const exif = parseExifBlock(meta.exif);
      result.capturedAt =
        parseExifDate(exif.DateTimeOriginal) ?? parseExifDate(exif.DateTime);
      result.lat = parseGpsCoord(exif.GPSLatitude, exif.GPSLatitudeRef);
      result.lng = parseGpsCoord(exif.GPSLongitude, exif.GPSLongitudeRef);
    } catch {
      // EXIF is advisory; a malformed block must never fail an upload.
    }
  }

  const thumbKey = `media/${mediaId}/thumb.webp`;
  const webKey = `media/${mediaId}/web.webp`;

  // `.rotate()` with no argument applies the EXIF orientation and strips it, so
  // derivatives are upright everywhere regardless of viewer support.
  const thumb = await image
    .clone()
    .rotate()
    .resize(400, 400, { fit: "cover", position: "attention" })
    .webp({ quality: 78 })
    .toBuffer();
  await storage.put(thumbKey, thumb);
  result.thumbKey = thumbKey;

  const web = await image
    .clone()
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
  await storage.put(webKey, web);
  result.webKey = webKey;

  return result;
}

async function processAv(
  buffer: Buffer,
  mediaId: string,
  kind: "video" | "audio",
  ext: string,
): Promise<ProcessResult> {
  const result: ProcessResult = { ...EMPTY };

  // ffmpeg/ffprobe need a real path, so stage the bytes in a temp file.
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tagpool-"));
  const tmpIn = path.join(dir, `input${ext}`);

  try {
    await fsp.writeFile(tmpIn, buffer);

    const info = await probeAv(tmpIn);
    result.durationMs = info.durationMs;
    result.width = info.width;
    result.height = info.height;

    if (kind === "video") {
      const tmpPoster = path.join(dir, "poster.jpg");
      const ok = await extractPosterFrame(tmpIn, tmpPoster, info.durationMs);
      if (ok) {
        const raw = await fsp.readFile(tmpPoster);
        const posterKey = `media/${mediaId}/poster.webp`;
        const thumbKey = `media/${mediaId}/thumb.webp`;

        await storage.put(
          posterKey,
          await sharp(raw).webp({ quality: 82 }).toBuffer(),
        );
        await storage.put(
          thumbKey,
          await sharp(raw)
            .resize(400, 400, { fit: "cover", position: "attention" })
            .webp({ quality: 78 })
            .toBuffer(),
        );

        result.posterKey = posterKey;
        result.thumbKey = thumbKey;
      }
    } else {
      result.waveform = await extractWaveform(tmpIn);
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }

  return result;
}

export async function processMedia(
  buffer: Buffer,
  mediaId: string,
  kind: MediaKind,
  originalName: string,
): Promise<ProcessResult> {
  const ext = path.extname(originalName).toLowerCase().slice(0, 10) || "";

  if (kind === "photo") return processImage(buffer, mediaId);
  return processAv(buffer, mediaId, kind, ext);
}

/**
 * Minimal TIFF/EXIF reader for the handful of tags we care about. Avoids adding
 * a parsing dependency for what amounts to three fields.
 */
function parseExifBlock(buf: Buffer): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // sharp's exif buffer starts with the "Exif\0\0" header on some inputs.
  let base = 0;
  if (buf.length > 6 && buf.toString("ascii", 0, 4) === "Exif") base = 6;
  if (buf.length < base + 8) return out;

  const endian = buf.toString("ascii", base, base + 2);
  if (endian !== "II" && endian !== "MM") return out;
  const le = endian === "II";

  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  const TAGS: Record<number, string> = {
    0x0132: "DateTime",
    0x9003: "DateTimeOriginal",
    0x8769: "ExifIFDPointer",
    0x8825: "GPSIFDPointer",
    0x0001: "GPSLatitudeRef",
    0x0002: "GPSLatitude",
    0x0003: "GPSLongitudeRef",
    0x0004: "GPSLongitude",
  };

  const readIfd = (offset: number, gps: boolean) => {
    if (offset + 2 > buf.length || offset < 0) return;
    const count = u16(offset);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > buf.length) return;

      const tag = u16(entry);
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      const name = TAGS[tag];
      if (!name) continue;

      const inlineSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 }[type] ?? 0;
      const total = inlineSize * n;
      const valueOffset =
        total > 4 ? base + u32(entry + 8) : entry + 8;
      if (valueOffset < 0 || valueOffset + total > buf.length) continue;

      if (name === "ExifIFDPointer" && !gps) {
        readIfd(base + u32(entry + 8), false);
      } else if (name === "GPSIFDPointer" && !gps) {
        readIfd(base + u32(entry + 8), true);
      } else if (type === 2) {
        out[name] = buf
          .toString("ascii", valueOffset, valueOffset + Math.max(0, n - 1))
          .replace(/\0.*$/, "");
      } else if (type === 5 && n === 3) {
        const rat = (o: number) => {
          const num = u32(o);
          const den = u32(o + 4);
          return den === 0 ? 0 : num / den;
        };
        out[name] = [
          rat(valueOffset),
          rat(valueOffset + 8),
          rat(valueOffset + 16),
        ];
      }
    }
  };

  readIfd(base + u32(base + 4), false);
  return out;
}
