import { eq } from "drizzle-orm";

import { isAdmin } from "@/lib/config";
import { db } from "@/lib/db";
import { media, mediaTags, type User } from "@/lib/db/schema";
import { storage } from "@/lib/storage";
import { bumpUsage } from "@/lib/tags/service";

export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "forbidden" };

export function canDelete(
  viewer: User | null,
  ownerId: string,
): boolean {
  if (!viewer) return false;
  return viewer.id === ownerId || isAdmin(viewer.handle);
}

/**
 * Remove an upload: its stored objects, its row, and its contribution to tag
 * usage counts.
 *
 * Order matters. Tag links are read before the row goes (the cascade would take
 * them with it), and storage objects are removed last — an orphaned object
 * wastes a few KB, whereas a row pointing at bytes that no longer exist renders
 * as a broken image on someone's page.
 */
export async function deleteMedia(
  id: string,
  viewer: User | null,
): Promise<DeleteResult> {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const item = rows[0];
  if (!item) return { ok: false, reason: "not-found" };

  if (!canDelete(viewer, item.ownerId)) {
    return { ok: false, reason: "forbidden" };
  }

  const links = await db
    .select({ tagId: mediaTags.tagId })
    .from(mediaTags)
    .where(eq(mediaTags.mediaId, id));

  // Deleting the row cascades to media_tags via the FK.
  await db.delete(media).where(eq(media.id, id));

  if (links.length > 0) {
    await bumpUsage(
      links.map((l) => l.tagId),
      -1,
    );
  }

  const keys = [
    item.storageKey,
    item.thumbKey,
    item.webKey,
    item.posterKey,
  ].filter((k): k is string => Boolean(k));

  await Promise.all(
    keys.map(async (key) => {
      try {
        await storage.delete(key);
      } catch (error) {
        // The row is already gone, so the upload is deleted as far as anyone
        // can tell. Log the leftover object rather than failing the request.
        console.error(`[delete] could not remove ${key}:`, error);
      }
    }),
  );

  return { ok: true };
}
