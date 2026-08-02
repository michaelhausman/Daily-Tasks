import { and, eq, inArray } from "drizzle-orm";

import { isAdmin } from "@/lib/config";
import { db } from "@/lib/db";
import {
  media,
  mediaTags,
  type Facet,
  type User,
  type Visibility,
} from "@/lib/db/schema";
import { isValidEventDate } from "@/lib/tags/normalize";
import { bumpUsage, resolveTags, type TagInput } from "@/lib/tags/service";

export type EditInput = {
  caption: string | null;
  eventDate: string | null;
  visibility: Visibility;
  tags: TagInput[];
};

export type EditResult =
  | { ok: true }
  | { ok: false; error: string };

export function canEdit(viewer: User | null, ownerId: string): boolean {
  if (!viewer) return false;
  return viewer.id === ownerId || isAdmin(viewer.handle);
}

/**
 * Update an upload's metadata. The file itself is never touched — replacing the
 * media would orphan its derivatives and change what everyone who already
 * commented was looking at, so that's a delete-and-reupload, not an edit.
 */
export async function editMedia(
  id: string,
  viewer: User | null,
  input: EditInput,
): Promise<EditResult> {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const item = rows[0];
  if (!item) return { ok: false, error: "That upload no longer exists." };

  if (!canEdit(viewer, item.ownerId)) {
    return { ok: false, error: "You can only edit your own uploads." };
  }

  if (input.eventDate && !isValidEventDate(input.eventDate)) {
    return { ok: false, error: "Date must be a real calendar date." };
  }
  if (input.tags.length > 24) {
    return { ok: false, error: "Too many tags (max 24)." };
  }

  await db
    .update(media)
    .set({
      caption: input.caption?.trim().slice(0, 2000) || null,
      eventDate: input.eventDate || null,
      visibility: input.visibility,
    })
    .where(eq(media.id, id));

  // ── tags ────────────────────────────────────────────────────────────────
  // Diffed rather than deleted-and-recreated. Wiping every link and re-adding
  // would churn usage counts to zero and back, and any tag that lost its last
  // reference mid-flight would briefly vanish from Explore.
  const resolved = await resolveTags(input.tags);
  const wanted = new Set(resolved.map((t) => t.id));

  const existing = await db
    .select({ tagId: mediaTags.tagId })
    .from(mediaTags)
    .where(eq(mediaTags.mediaId, id));
  const current = new Set(existing.map((r) => r.tagId));

  const toAdd = [...wanted].filter((t) => !current.has(t));
  const toRemove = [...current].filter((t) => !wanted.has(t));

  if (toAdd.length > 0) {
    await db
      .insert(mediaTags)
      .values(toAdd.map((tagId) => ({ mediaId: id, tagId })));
    await bumpUsage(toAdd, 1);
  }

  if (toRemove.length > 0) {
    await db
      .delete(mediaTags)
      .where(
        and(eq(mediaTags.mediaId, id), inArray(mediaTags.tagId, toRemove)),
      );
    await bumpUsage(toRemove, -1);
  }

  return { ok: true };
}

/** Current tag labels grouped by facet, to prefill the edit form. */
export function groupTagsByFacet(
  tags: Array<{ facet: Facet; label: string }>,
): Record<Facet, string[]> {
  return {
    who: tags.filter((t) => t.facet === "who").map((t) => t.label),
    where: tags.filter((t) => t.facet === "where").map((t) => t.label),
    topic: tags.filter((t) => t.facet === "topic").map((t) => t.label),
  };
}
