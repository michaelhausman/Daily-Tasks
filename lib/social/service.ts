import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  comments,
  likes,
  media,
  mediaTags,
  momentFollows,
  tagFollows,
  tags,
  users,
} from "@/lib/db/schema";
import { newId } from "@/lib/ids";

// ─── likes ───────────────────────────────────────────────────────────────────

export async function toggleLike(
  userId: string,
  mediaId: string,
): Promise<{ liked: boolean; count: number }> {
  const existing = await db
    .select({ mediaId: likes.mediaId })
    .from(likes)
    .where(and(eq(likes.userId, userId), eq(likes.mediaId, mediaId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(likes)
      .where(and(eq(likes.userId, userId), eq(likes.mediaId, mediaId)));
  } else {
    await db.insert(likes).values({ userId, mediaId });
  }

  return { liked: existing.length === 0, count: await countLikes(mediaId) };
}

export async function countLikes(mediaId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<string>`count(*)` })
    .from(likes)
    .where(eq(likes.mediaId, mediaId));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Like counts and the viewer's own likes for a page of media, in two queries
 * rather than two per card.
 */
export async function likeStateFor(
  mediaIds: string[],
  viewerId?: string,
): Promise<Map<string, { count: number; liked: boolean }>> {
  const out = new Map<string, { count: number; liked: boolean }>();
  if (mediaIds.length === 0) return out;

  const counts = await db
    .select({ mediaId: likes.mediaId, n: sql<string>`count(*)` })
    .from(likes)
    .where(inArray(likes.mediaId, mediaIds))
    .groupBy(likes.mediaId);

  for (const id of mediaIds) out.set(id, { count: 0, liked: false });
  for (const row of counts) {
    out.set(row.mediaId, { count: Number(row.n), liked: false });
  }

  if (viewerId) {
    const mine = await db
      .select({ mediaId: likes.mediaId })
      .from(likes)
      .where(
        and(eq(likes.userId, viewerId), inArray(likes.mediaId, mediaIds)),
      );
    for (const row of mine) {
      const entry = out.get(row.mediaId);
      if (entry) entry.liked = true;
    }
  }

  return out;
}

// ─── comments ────────────────────────────────────────────────────────────────

export type CommentWithAuthor = {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; handle: string; displayName: string };
};

export type CommentTarget =
  | { kind: "media"; mediaId: string }
  | { kind: "moment"; whereSlug: string; eventDate: string };

export async function addComment(
  authorId: string,
  target: CommentTarget,
  rawBody: string,
): Promise<{ ok: boolean; error?: string }> {
  const body = rawBody.trim().slice(0, 2000);
  if (!body) return { ok: false, error: "Say something first." };

  await db.insert(comments).values({
    id: newId(),
    authorId,
    body,
    mediaId: target.kind === "media" ? target.mediaId : null,
    momentWhere: target.kind === "moment" ? target.whereSlug : null,
    momentDate: target.kind === "moment" ? target.eventDate : null,
  });

  return { ok: true };
}

export async function listComments(
  target: CommentTarget,
): Promise<CommentWithAuthor[]> {
  const where =
    target.kind === "media"
      ? eq(comments.mediaId, target.mediaId)
      : and(
          eq(comments.momentWhere, target.whereSlug),
          eq(comments.momentDate, target.eventDate),
        );

  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorId: users.id,
      handle: users.handle,
      displayName: users.displayName,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(where)
    .orderBy(comments.createdAt)
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    author: { id: r.authorId, handle: r.handle, displayName: r.displayName },
  }));
}

export async function getCommentAuthor(id: string): Promise<string | null> {
  const rows = await db
    .select({ authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.id, id))
    .limit(1);
  return rows[0]?.authorId ?? null;
}

export async function deleteComment(id: string): Promise<void> {
  await db.delete(comments).where(eq(comments.id, id));
}

export async function countMomentComments(
  keys: Array<{ whereSlug: string; eventDate: string }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (keys.length === 0) return out;

  const rows = await db
    .select({
      whereSlug: comments.momentWhere,
      eventDate: comments.momentDate,
      n: sql<string>`count(*)`,
    })
    .from(comments)
    .where(
      sql`(${sql.join(
        keys.map(
          (k) =>
            sql`(${comments.momentWhere} = ${k.whereSlug} AND ${comments.momentDate} = ${k.eventDate})`,
        ),
        sql` OR `,
      )})`,
    )
    .groupBy(comments.momentWhere, comments.momentDate);

  for (const r of rows) {
    if (r.whereSlug && r.eventDate) {
      out.set(`${r.whereSlug}|${r.eventDate}`, Number(r.n));
    }
  }
  return out;
}

// ─── follows ─────────────────────────────────────────────────────────────────

export async function toggleTagFollow(
  userId: string,
  tagId: string,
): Promise<boolean> {
  const existing = await db
    .select({ tagId: tagFollows.tagId })
    .from(tagFollows)
    .where(and(eq(tagFollows.userId, userId), eq(tagFollows.tagId, tagId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(tagFollows)
      .where(and(eq(tagFollows.userId, userId), eq(tagFollows.tagId, tagId)));
    return false;
  }

  await db.insert(tagFollows).values({ userId, tagId });
  return true;
}

export async function toggleMomentFollow(
  userId: string,
  whereSlug: string,
  eventDate: string,
): Promise<boolean> {
  const match = and(
    eq(momentFollows.userId, userId),
    eq(momentFollows.whereSlug, whereSlug),
    eq(momentFollows.eventDate, eventDate),
  );

  const existing = await db
    .select({ whereSlug: momentFollows.whereSlug })
    .from(momentFollows)
    .where(match)
    .limit(1);

  if (existing.length > 0) {
    await db.delete(momentFollows).where(match);
    return false;
  }

  await db.insert(momentFollows).values({ userId, whereSlug, eventDate });
  return true;
}

export async function isFollowingTag(
  userId: string,
  tagId: string,
): Promise<boolean> {
  const rows = await db
    .select({ tagId: tagFollows.tagId })
    .from(tagFollows)
    .where(and(eq(tagFollows.userId, userId), eq(tagFollows.tagId, tagId)))
    .limit(1);
  return rows.length > 0;
}

export async function isFollowingMoment(
  userId: string,
  whereSlug: string,
  eventDate: string,
): Promise<boolean> {
  const rows = await db
    .select({ whereSlug: momentFollows.whereSlug })
    .from(momentFollows)
    .where(
      and(
        eq(momentFollows.userId, userId),
        eq(momentFollows.whereSlug, whereSlug),
        eq(momentFollows.eventDate, eventDate),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function followedTags(userId: string) {
  return db
    .select({
      id: tags.id,
      facet: tags.facet,
      slug: tags.slug,
      label: tags.label,
      usageCount: tags.usageCount,
    })
    .from(tagFollows)
    .innerJoin(tags, eq(tags.id, tagFollows.tagId))
    .where(eq(tagFollows.userId, userId))
    .orderBy(desc(tags.usageCount));
}

export async function followedMomentKeys(userId: string) {
  const rows = await db
    .select({
      whereSlug: momentFollows.whereSlug,
      eventDate: momentFollows.eventDate,
    })
    .from(momentFollows)
    .where(eq(momentFollows.userId, userId))
    .orderBy(desc(momentFollows.createdAt));
  return rows;
}

/**
 * Recent uploads carrying any tag the viewer follows.
 *
 * This is the payoff for following: log in and the first thing you see is new
 * material from the artists and venues you care about, rather than whatever
 * happened to be posted most recently across the whole site.
 */
export async function mediaFromFollowedTags(
  userId: string,
  limit = 12,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: media.id, createdAt: media.createdAt })
    .from(media)
    .innerJoin(mediaTags, eq(mediaTags.mediaId, media.id))
    .innerJoin(tagFollows, eq(tagFollows.tagId, mediaTags.tagId))
    .where(
      and(
        eq(tagFollows.userId, userId),
        eq(media.status, "ready"),
        eq(media.visibility, "public"),
      ),
    )
    .orderBy(desc(media.createdAt))
    .limit(limit);

  return rows.map((r) => r.id);
}
