import { Readable } from "node:stream";
import type { NextRequest } from "next/server";

import { isSafeKey, storage } from "@/lib/storage";
import { contentTypeForKey } from "@/lib/storage/mime";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await context.params;
  const key = segments.join("/");

  if (!isSafeKey(key)) {
    return new Response("Bad request", { status: 400 });
  }

  const info = await storage.stat(key);
  if (!info) {
    return new Response("Not found", { status: 404 });
  }

  const type = contentTypeForKey(key);
  const baseHeaders: Record<string, string> = {
    "Content-Type": type,
    // Keys are content-addressed by media id and never rewritten in place, so
    // these are safe to cache hard.
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    // Stops a crafted upload from being served back as an executable document.
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };

  // Range support is what lets a browser scrub a video or audio track without
  // downloading the whole file first.
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const [, rawStart, rawEnd] = match;
      let start = rawStart ? Number(rawStart) : 0;
      let end = rawEnd ? Number(rawEnd) : info.bytes - 1;

      if (!rawStart && rawEnd) {
        // Suffix form: "bytes=-500" means the final 500 bytes.
        start = Math.max(0, info.bytes - Number(rawEnd));
        end = info.bytes - 1;
      }

      if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start <= end &&
        start < info.bytes
      ) {
        end = Math.min(end, info.bytes - 1);
        const stream = await storage.createReadStream(key, { start, end });
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${info.bytes}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }

      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${info.bytes}` },
      });
    }
  }

  const stream = await storage.createReadStream(key);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(info.bytes) },
  });
}
