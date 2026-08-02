import path from "node:path";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { db } from "@/lib/db";
import { media, mediaTags, type Facet, type Visibility } from "@/lib/db/schema";
import { kindFromMime, processMedia } from "@/lib/media/process";
import { storage } from "@/lib/storage";
import { isValidEventDate } from "@/lib/tags/normalize";
import { bumpUsage, resolveTags, type TagInput } from "@/lib/tags/service";

const MAX_BYTES = 512 * 1024 * 1024;

const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif|avif|heic|heif)|video\/(mp4|webm|quicktime|x-m4v)|audio\/(mpeg|mp4|wav|x-wav|ogg|opus|flac|aac|x-m4a))$/;

/** Extensions we are willing to write to disk, keyed off the sniffed kind. */
const SAFE_EXT = /^\.[a-z0-9]{1,5}$/;

function safeExtension(name: string, mime: string): string {
  const ext = path.extname(name).toLowerCase();
  if (SAFE_EXT.test(ext)) return ext;
  if (mime.startsWith("image/")) return ".jpg";
  if (mime.startsWith("video/")) return ".mp4";
  return ".mp3";
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "You must be logged in to upload." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Malformed upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ error: "File is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `File exceeds the ${Math.round(MAX_BYTES / 1024 / 1024)}MB limit.` },
      { status: 413 },
    );
  }
  if (!ALLOWED_MIME.test(file.type)) {
    return Response.json(
      { error: `Unsupported file type: ${file.type || "unknown"}.` },
      { status: 415 },
    );
  }

  const kind = kindFromMime(file.type);
  if (!kind) {
    return Response.json({ error: "Unsupported file type." }, { status: 415 });
  }

  // --- tags -------------------------------------------------------------
  const tagInputs: TagInput[] = [];
  for (const facet of ["who", "where", "topic"] as Facet[]) {
    for (const raw of form.getAll(facet)) {
      if (typeof raw === "string" && raw.trim()) {
        tagInputs.push({ facet, label: raw });
      }
    }
  }
  if (tagInputs.length > 24) {
    return Response.json({ error: "Too many tags (max 24)." }, { status: 400 });
  }

  const eventDateRaw = String(form.get("eventDate") ?? "").trim();
  if (eventDateRaw && !isValidEventDate(eventDateRaw)) {
    return Response.json(
      { error: "Date must be a real calendar date in YYYY-MM-DD form." },
      { status: 400 },
    );
  }

  const caption = String(form.get("caption") ?? "").trim().slice(0, 2000) || null;
  const visibilityRaw = String(form.get("visibility") ?? "public");
  const visibility: Visibility =
    visibilityRaw === "unlisted" ? "unlisted" : "public";

  // --- store ------------------------------------------------------------
  const id = newId();
  const originalName = (file.name || "upload").slice(0, 200);
  const ext = safeExtension(originalName, file.type);
  const storageKey = `media/${id}/original${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await storage.put(storageKey, buffer);

  await db.insert(media).values({
    id,
    ownerId: user.id,
    kind,
    storageKey,
    mime: file.type,
    bytes: buffer.byteLength,
    originalName,
    caption,
    eventDate: eventDateRaw || null,
    visibility,
    status: "processing",
  });

  // --- derive -----------------------------------------------------------
  // Inline for now. This is the piece that moves to a worker queue first when
  // real traffic arrives; nothing else about the route needs to change.
  try {
    const derived = await processMedia(buffer, id, kind, originalName);

    // If the uploader left the date blank and the file knows when it was shot,
    // adopt it. This is the highest-value autofill in the app: the date facet
    // is the one people are most likely to skip or mistype.
    const eventDate =
      eventDateRaw ||
      (derived.capturedAt
        ? derived.capturedAt.toISOString().slice(0, 10)
        : null);

    await db
      .update(media)
      .set({
        thumbKey: derived.thumbKey,
        webKey: derived.webKey,
        posterKey: derived.posterKey,
        waveformJson: derived.waveform
          ? JSON.stringify(derived.waveform)
          : null,
        width: derived.width,
        height: derived.height,
        durationMs: derived.durationMs,
        capturedAt: derived.capturedAt,
        lat: derived.lat,
        lng: derived.lng,
        eventDate,
        status: "ready",
      })
      .where(eq(media.id, id));
  } catch (error) {
    console.error(`[upload] processing failed for ${id}:`, error);
    // The original bytes are already stored and playable, so a derivative
    // failure shouldn't lose the upload — mark it ready without derivatives.
    await db.update(media).set({ status: "ready" }).where(eq(media.id, id));
  }

  // --- link tags --------------------------------------------------------
  const resolved = await resolveTags(tagInputs);
  if (resolved.length > 0) {
    await db
      .insert(mediaTags)
      .values(resolved.map((t) => ({ mediaId: id, tagId: t.id })));
    await bumpUsage(resolved.map((t) => t.id));
  }

  return Response.json({ id, url: `/media/${id}` }, { status: 201 });
}
