import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  comments,
  media,
  mediaTags,
  reports,
  tags,
  users,
  type Facet,
  type ReportReason,
} from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { rowsOf } from "@/lib/media/queries";
import { repointShows } from "@/lib/shows/service";
import { matchKey, slugify } from "@/lib/tags/normalize";
import { bumpUsage } from "@/lib/tags/service";

// ─── hide / unhide ───────────────────────────────────────────────────────────

export async function hideMedia(
  mediaId: string,
  moderatorHandle: string,
  reason: string,
): Promise<void> {
  await db
    .update(media)
    .set({
      hiddenAt: new Date(),
      hiddenBy: moderatorHandle,
      hiddenReason: reason.trim().slice(0, 500) || "No reason given",
    })
    .where(eq(media.id, mediaId));
}

export async function unhideMedia(mediaId: string): Promise<void> {
  await db
    .update(media)
    .set({ hiddenAt: null, hiddenBy: null, hiddenReason: null })
    .where(eq(media.id, mediaId));
}

// ─── suspend / reinstate ─────────────────────────────────────────────────────

/**
 * Suspending hides everything the account posted rather than deleting it, so
 * reinstating restores the archive intact. Uploads hidden by an individual
 * moderation decision keep their own reason, so a later reinstate doesn't
 * silently un-hide something that was taken down on its own merits.
 */
const SUSPENSION_REASON = "Account suspended";

export async function suspendUser(
  userId: string,
  moderatorHandle: string,
  reason: string,
): Promise<{ hiddenCount: number }> {
  const cleanReason = reason.trim().slice(0, 500) || "No reason given";

  await db
    .update(users)
    .set({ suspendedAt: new Date(), suspendedReason: cleanReason })
    .where(eq(users.id, userId));

  const affected = await db
    .update(media)
    .set({
      hiddenAt: new Date(),
      hiddenBy: moderatorHandle,
      hiddenReason: SUSPENSION_REASON,
    })
    .where(and(eq(media.ownerId, userId), isNull(media.hiddenAt)))
    .returning();

  return { hiddenCount: affected.length };
}

export async function reinstateUser(
  userId: string,
): Promise<{ restoredCount: number }> {
  await db
    .update(users)
    .set({ suspendedAt: null, suspendedReason: null })
    .where(eq(users.id, userId));

  const restored = await db
    .update(media)
    .set({ hiddenAt: null, hiddenBy: null, hiddenReason: null })
    .where(
      and(
        eq(media.ownerId, userId),
        eq(media.hiddenReason, SUSPENSION_REASON),
      ),
    )
    .returning();

  return { restoredCount: restored.length };
}

// ─── reports ─────────────────────────────────────────────────────────────────

export type ReportTarget =
  | { kind: "media"; mediaId: string }
  | { kind: "comment"; commentId: string }
  | { kind: "moment"; whereSlug: string; eventDate: string };

export async function fileReport(
  reporterId: string,
  target: ReportTarget,
  reason: ReportReason,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  // One open report per person per thing — repeat clicks shouldn't inflate the
  // queue, and a second opinion from the same account adds nothing.
  const duplicateWhere =
    target.kind === "media"
      ? and(eq(reports.reporterId, reporterId), eq(reports.mediaId, target.mediaId))
      : target.kind === "comment"
        ? and(
            eq(reports.reporterId, reporterId),
            eq(reports.commentId, target.commentId),
          )
        : and(
            eq(reports.reporterId, reporterId),
            eq(reports.momentWhere, target.whereSlug),
            eq(reports.momentDate, target.eventDate),
          );

  const existing = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(duplicateWhere, eq(reports.status, "open")))
    .limit(1);

  if (existing.length > 0) {
    return { ok: false, error: "You've already reported this. We're on it." };
  }

  await db.insert(reports).values({
    id: newId(),
    reporterId,
    reason,
    note: note.trim().slice(0, 1000) || null,
    mediaId: target.kind === "media" ? target.mediaId : null,
    commentId: target.kind === "comment" ? target.commentId : null,
    momentWhere: target.kind === "moment" ? target.whereSlug : null,
    momentDate: target.kind === "moment" ? target.eventDate : null,
  });

  return { ok: true };
}

export type QueuedReport = {
  id: string;
  reason: string;
  note: string | null;
  createdAt: Date;
  reporter: string;
  target:
    | { kind: "media"; mediaId: string; caption: string | null; owner: string; hidden: boolean }
    | { kind: "comment"; commentId: string; body: string; author: string }
    | { kind: "moment"; whereSlug: string; eventDate: string }
    | { kind: "gone" };
};

export async function openReports(limit = 50): Promise<QueuedReport[]> {
  const rows = await db
    .select({
      report: reports,
      reporter: users.handle,
    })
    .from(reports)
    .innerJoin(users, eq(users.id, reports.reporterId))
    .where(eq(reports.status, "open"))
    .orderBy(desc(reports.createdAt))
    .limit(limit);

  const out: QueuedReport[] = [];

  for (const { report, reporter } of rows) {
    let target: QueuedReport["target"] = { kind: "gone" };

    if (report.mediaId) {
      const m = await db
        .select({
          id: media.id,
          caption: media.caption,
          owner: users.handle,
          hiddenAt: media.hiddenAt,
        })
        .from(media)
        .innerJoin(users, eq(users.id, media.ownerId))
        .where(eq(media.id, report.mediaId))
        .limit(1);
      if (m[0]) {
        target = {
          kind: "media",
          mediaId: m[0].id,
          caption: m[0].caption,
          owner: m[0].owner,
          hidden: m[0].hiddenAt !== null,
        };
      }
    } else if (report.commentId) {
      const c = await db
        .select({ id: comments.id, body: comments.body, author: users.handle })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.authorId))
        .where(eq(comments.id, report.commentId))
        .limit(1);
      if (c[0]) {
        target = { kind: "comment", commentId: c[0].id, body: c[0].body, author: c[0].author };
      }
    } else if (report.momentWhere && report.momentDate) {
      target = {
        kind: "moment",
        whereSlug: report.momentWhere,
        eventDate: report.momentDate,
      };
    }

    out.push({
      id: report.id,
      reason: report.reason,
      note: report.note,
      createdAt: report.createdAt,
      reporter,
      target,
    });
  }

  return out;
}

export async function resolveReport(
  id: string,
  status: "actioned" | "dismissed",
  moderatorHandle: string,
): Promise<void> {
  await db
    .update(reports)
    .set({ status, resolvedAt: new Date(), resolvedBy: moderatorHandle })
    .where(eq(reports.id, id));
}

export async function countOpenReports(): Promise<number> {
  const rows = await db
    .select({ n: sql<string>`count(*)` })
    .from(reports)
    .where(eq(reports.status, "open"));
  return Number(rows[0]?.n ?? 0);
}

// ─── tags ────────────────────────────────────────────────────────────────────

/**
 * A bad tag is worse than a bad photo: it pollutes browse for everyone and
 * survives deleting every upload that used it. These three operations are the
 * minimum needed to clean one up.
 */
export async function renameTag(
  tagId: string,
  newLabel: string,
): Promise<{ ok: boolean; error?: string }> {
  const label = newLabel.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!label) return { ok: false, error: "Give the tag a name." };

  const slug = slugify(label);
  if (!slug) return { ok: false, error: "That name has no usable characters." };

  const current = await db
    .select()
    .from(tags)
    .where(eq(tags.id, tagId))
    .limit(1);
  if (!current[0]) return { ok: false, error: "That tag no longer exists." };

  const clash = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.facet, current[0].facet), eq(tags.slug, slug)))
    .limit(1);

  if (clash[0] && clash[0].id !== tagId) {
    return {
      ok: false,
      error: "A tag with that name already exists — merge into it instead.",
    };
  }

  // The loose key is derived from the label, so renaming has to recompute it
  // or suggestions keep matching the old spelling.
  await db
    .update(tags)
    .set({ label, slug, matchKey: matchKey(label) })
    .where(eq(tags.id, tagId));
  return { ok: true };
}

/**
 * Repoint every upload from `fromId` onto `intoId`, then leave the old tag as
 * an alias so anything still referencing it resolves to the survivor.
 */
export async function mergeTags(
  fromId: string,
  intoId: string,
): Promise<{ ok: boolean; error?: string; moved?: number }> {
  if (fromId === intoId) return { ok: false, error: "Pick two different tags." };

  const both = await db
    .select()
    .from(tags)
    .where(sql`${tags.id} IN (${fromId}, ${intoId})`);

  const from = both.find((t) => t.id === fromId);
  const into = both.find((t) => t.id === intoId);
  if (!from || !into) return { ok: false, error: "One of those tags is gone." };
  if (from.facet !== into.facet) {
    return { ok: false, error: "Tags must be in the same facet to merge." };
  }

  const links = await db
    .select({ mediaId: mediaTags.mediaId })
    .from(mediaTags)
    .where(eq(mediaTags.tagId, fromId));

  let moved = 0;
  for (const link of links) {
    // The target may already carry this upload; the primary key would reject a
    // duplicate, so skip rather than fail the whole merge.
    const already = await db
      .select({ tagId: mediaTags.tagId })
      .from(mediaTags)
      .where(
        and(eq(mediaTags.mediaId, link.mediaId), eq(mediaTags.tagId, intoId)),
      )
      .limit(1);

    if (already.length === 0) {
      await db
        .insert(mediaTags)
        .values({ mediaId: link.mediaId, tagId: intoId });
      moved++;
    }
  }

  await db.delete(mediaTags).where(eq(mediaTags.tagId, fromId));
  await repointShows(fromId, intoId);
  await db
    .update(tags)
    .set({ canonicalTagId: intoId, usageCount: 0 })
    .where(eq(tags.id, fromId));

  if (moved > 0) await bumpUsage([intoId], moved);

  return { ok: true, moved };
}

export async function deleteTag(tagId: string): Promise<void> {
  // media_tags rows cascade; the uploads themselves are untouched. Shows filed
  // under the tag cascade too — a show with no performer or no place is no
  // longer a moment anyone can find.
  await db.delete(tags).where(eq(tags.id, tagId));
}

export type TagListing = {
  id: string;
  facet: Facet;
  slug: string;
  label: string;
  usageCount: number;
  showCount: number;
  /** Set when this tag was merged away — the label it now resolves to. */
  aliasOf: string | null;
};

/**
 * One page of tags, filtered.
 *
 * This used to be every tag at once, with every sibling rendered into a merge
 * dropdown on every row — fine at twenty tags and quadratic after that. One
 * touring history took it past seven hundred places, which is half a million
 * option elements and a page no phone can open.
 *
 * Searching matches the loose key as well as the slug, so looking for the
 * duplicate of "Wilbur Theater" finds "The Wilbur Theatre, Boston" — which is
 * the main reason to come here at all.
 */
export async function findTags(opts: {
  query?: string;
  facet?: Facet | null;
  page?: number;
  perPage?: number;
}): Promise<{
  rows: TagListing[];
  total: number;
  page: number;
  pages: number;
}> {
  const perPage = Math.min(Math.max(opts.perPage ?? 50, 1), 200);
  const slug = slugify(opts.query ?? "");
  const key = matchKey(opts.query ?? "");

  const where: SQL[] = [];
  if (opts.facet) where.push(sql`t.facet = ${opts.facet}`);
  if (slug || key) {
    const parts: SQL[] = [];
    if (slug) parts.push(sql`t.slug LIKE ${`%${slug}%`}`);
    if (key) parts.push(sql`t.match_key LIKE ${`%${key}%`}`);
    where.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  const filter = where.length > 0 ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const totalRows = rowsOf<{ n: string | number }>(
    await db.execute(sql`SELECT COUNT(*) AS n FROM tags t ${filter}`),
  );
  const total = Number(totalRows[0]?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(opts.page ?? 1, 1), pages);

  const result = await db.execute(sql`
    SELECT
      t.id, t.facet, t.slug, t.label, t.usage_count,
      a.label AS alias_of,
      (
        SELECT COUNT(*) FROM shows s
        WHERE s.who_tag_id = t.id OR s.where_tag_id = t.id
      ) AS show_count
    FROM tags t
      LEFT JOIN tags a ON a.id = t.canonical_tag_id
    ${filter}
    ORDER BY t.usage_count DESC, t.label
    LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
  `);

  const rows = rowsOf<{
    id: string;
    facet: Facet;
    slug: string;
    label: string;
    usage_count: number;
    alias_of: string | null;
    show_count: string | number;
  }>(result).map((r) => ({
    id: r.id,
    facet: r.facet,
    slug: r.slug,
    label: r.label,
    usageCount: r.usage_count,
    showCount: Number(r.show_count),
    aliasOf: r.alias_of,
  }));

  return { rows, total, page, pages };
}

// ─── recent activity, for the queue ──────────────────────────────────────────

export async function recentUploads(limit = 24) {
  return db
    .select({
      id: media.id,
      caption: media.caption,
      kind: media.kind,
      thumbKey: media.thumbKey,
      createdAt: media.createdAt,
      hiddenAt: media.hiddenAt,
      hiddenReason: media.hiddenReason,
      owner: users.handle,
      ownerId: users.id,
      suspended: users.suspendedAt,
    })
    .from(media)
    .innerJoin(users, eq(users.id, media.ownerId))
    .orderBy(desc(media.createdAt))
    .limit(limit);
}

export async function recentComments(limit = 20) {
  return db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      author: users.handle,
      authorId: users.id,
      mediaId: comments.mediaId,
      momentWhere: comments.momentWhere,
      momentDate: comments.momentDate,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .orderBy(desc(comments.createdAt))
    .limit(limit);
}

export async function allUsers() {
  const rows = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
      createdAt: users.createdAt,
      suspendedAt: users.suspendedAt,
      suspendedReason: users.suspendedReason,
    })
    .from(users)
    .orderBy(users.handle);

  /**
   * Counted with a grouped query rather than a correlated subquery.
   *
   * The subquery version interpolated `users.id` as an unqualified `"id"`,
   * which resolved inside the subquery against `media.id` — so it compared
   * `media.owner_id = media.id` and silently returned zero for everyone
   * instead of failing. Two round trips beat a wrong number nobody notices.
   */
  const counts = await db
    .select({ ownerId: media.ownerId, n: sql<string>`count(*)` })
    .from(media)
    .groupBy(media.ownerId);

  const byOwner = new Map(counts.map((c) => [c.ownerId, Number(c.n)]));

  return rows.map((r) => ({ ...r, uploadCount: byOwner.get(r.id) ?? 0 }));
}
