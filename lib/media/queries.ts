import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  media,
  mediaTags,
  tags,
  users,
  type Facet,
  type Media,
  type Tag,
} from "@/lib/db/schema";

export type MediaWithOwner = Media & {
  owner: { handle: string; displayName: string };
};

export type MediaWithTags = MediaWithOwner & { tags: Tag[] };

export type FacetSelection = {
  who: string[];
  where: string[];
  topic: string[];
  dates: string[];
};

export const EMPTY_SELECTION: FacetSelection = {
  who: [],
  where: [],
  topic: [],
  dates: [],
};

export function selectionIsEmpty(sel: FacetSelection): boolean {
  return (
    sel.who.length === 0 &&
    sel.where.length === 0 &&
    sel.topic.length === 0 &&
    sel.dates.length === 0
  );
}

/**
 * The filter semantics that make "pick one or all of the tags" work:
 *
 *   OR *within* a facet   — two performers means "either performer"
 *   AND *across* facets   — performer + venue + date means all three must hold
 *
 * Picking only "Aimee Mann" gives you everything of hers ever. Adding the venue
 * and the date narrows to exactly one show. That progressive-narrowing feel is
 * the entire browse experience, and it falls out of this one rule.
 *
 * Implemented as one EXISTS subquery per facet rather than a join per facet,
 * which keeps the row count stable and avoids a DISTINCT.
 */
function facetCondition(facet: Facet, slugs: string[]): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${mediaTags}
    INNER JOIN ${tags} ON ${tags.id} = ${mediaTags.tagId}
    WHERE ${mediaTags.mediaId} = ${media.id}
      AND ${tags.facet} = ${facet}
      AND ${tags.slug} IN (${sql.join(
        slugs.map((s) => sql`${s}`),
        sql`, `,
      )})
  )`;
}

function buildFilters(sel: FacetSelection, viewerId?: string): SQL[] {
  const filters: SQL[] = [eq(media.status, "ready")];

  // Unlisted media is reachable by direct link but never surfaces in browse —
  // except for its owner, who should see their own uploads in their feed.
  filters.push(
    viewerId
      ? sql`(${media.visibility} = 'public' OR ${media.ownerId} = ${viewerId})`
      : sql`${media.visibility} = 'public'`,
  );

  if (sel.who.length) filters.push(facetCondition("who", sel.who));
  if (sel.where.length) filters.push(facetCondition("where", sel.where));
  if (sel.topic.length) filters.push(facetCondition("topic", sel.topic));

  if (sel.dates.length) {
    filters.push(inArray(media.eventDate, sel.dates));
  }

  return filters;
}

async function attachOwners(rows: Media[]): Promise<MediaWithOwner[]> {
  if (rows.length === 0) return [];

  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const owners = await db
    .select({
      id: users.id,
      handle: users.handle,
      displayName: users.displayName,
    })
    .from(users)
    .where(inArray(users.id, ownerIds));

  const byId = new Map(owners.map((o) => [o.id, o]));

  return rows.map((r) => {
    const o = byId.get(r.ownerId);
    return {
      ...r,
      owner: {
        handle: o?.handle ?? "unknown",
        displayName: o?.displayName ?? "Unknown",
      },
    };
  });
}

export async function attachTags(
  rows: MediaWithOwner[],
): Promise<MediaWithTags[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const links = await db
    .select({ mediaId: mediaTags.mediaId, tag: tags })
    .from(mediaTags)
    .innerJoin(tags, eq(tags.id, mediaTags.tagId))
    .where(inArray(mediaTags.mediaId, ids));

  const byMedia = new Map<string, Tag[]>();
  for (const link of links) {
    const list = byMedia.get(link.mediaId) ?? [];
    list.push(link.tag);
    byMedia.set(link.mediaId, list);
  }

  return rows.map((r) => ({ ...r, tags: byMedia.get(r.id) ?? [] }));
}

export async function findMedia(
  sel: FacetSelection,
  opts: { limit?: number; offset?: number; viewerId?: string } = {},
): Promise<MediaWithTags[]> {
  const { limit = 60, offset = 0, viewerId } = opts;

  const rows = await db
    .select()
    .from(media)
    .where(and(...buildFilters(sel, viewerId)))
    .orderBy(desc(media.createdAt))
    .limit(limit)
    .offset(offset);

  return attachTags(await attachOwners(rows));
}

export async function countMedia(
  sel: FacetSelection,
  viewerId?: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(media)
    .where(and(...buildFilters(sel, viewerId)));
  return rows[0]?.n ?? 0;
}

export type Moment = {
  who: { slug: string; label: string };
  where: { slug: string; label: string };
  eventDate: string;
  mediaCount: number;
  contributorCount: number;
  lastUpload: number;
  previewKeys: string[];
  kinds: string[];
};

/**
 * A Moment is not a row anybody creates. It is the observation that several
 * people independently tagged their uploads with the same performer, the same
 * place, and the same day — so those uploads are footage of one event and
 * belong on one page.
 *
 * Deriving it from a GROUP BY instead of storing it means a moment springs into
 * existence the instant the second person tags correctly, with no backfill and
 * nothing to keep in sync.
 */
export async function findMoments(
  opts: {
    limit?: number;
    who?: string;
    where?: string;
    eventDate?: string;
    minMedia?: number;
  } = {},
): Promise<Moment[]> {
  const { limit = 24, who, where, eventDate, minMedia = 1 } = opts;

  const conditions: SQL[] = [
    sql`m.status = 'ready'`,
    sql`m.visibility = 'public'`,
    sql`m.event_date IS NOT NULL`,
  ];
  if (who) conditions.push(sql`wt.slug = ${who}`);
  if (where) conditions.push(sql`rt.slug = ${where}`);
  if (eventDate) conditions.push(sql`m.event_date = ${eventDate}`);

  const rows = await db.all<{
    who_slug: string;
    who_label: string;
    where_slug: string;
    where_label: string;
    event_date: string;
    media_count: number;
    contributor_count: number;
    last_upload: number;
    preview_keys: string | null;
    kinds: string | null;
  }>(sql`
    SELECT
      wt.slug  AS who_slug,
      wt.label AS who_label,
      rt.slug  AS where_slug,
      rt.label AS where_label,
      m.event_date AS event_date,
      COUNT(DISTINCT m.id)       AS media_count,
      COUNT(DISTINCT m.owner_id) AS contributor_count,
      MAX(m.created_at)          AS last_upload,
      GROUP_CONCAT(COALESCE(m.thumb_key, '')) AS preview_keys,
      GROUP_CONCAT(DISTINCT m.kind)           AS kinds
    FROM media m
      INNER JOIN media_tags wmt ON wmt.media_id = m.id
      INNER JOIN tags wt        ON wt.id = wmt.tag_id AND wt.facet = 'who'
      INNER JOIN media_tags rmt ON rmt.media_id = m.id
      INNER JOIN tags rt        ON rt.id = rmt.tag_id AND rt.facet = 'where'
    WHERE ${sql.join(conditions, sql` AND `)}
    GROUP BY wt.slug, wt.label, rt.slug, rt.label, m.event_date
    HAVING COUNT(DISTINCT m.id) >= ${minMedia}
    ORDER BY last_upload DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    who: { slug: r.who_slug, label: r.who_label },
    where: { slug: r.where_slug, label: r.where_label },
    eventDate: r.event_date,
    mediaCount: Number(r.media_count),
    contributorCount: Number(r.contributor_count),
    lastUpload: Number(r.last_upload),
    previewKeys: (r.preview_keys ?? "")
      .split(",")
      .filter((k) => k.length > 0)
      .slice(0, 4),
    kinds: (r.kinds ?? "").split(",").filter(Boolean),
  }));
}

export async function getMediaById(
  id: string,
  viewerId?: string,
): Promise<MediaWithTags | null> {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;

  // Unlisted is link-shareable by design, so only `processing`/`failed` items
  // are owner-gated here.
  if (row.status !== "ready" && row.ownerId !== viewerId) return null;

  const withTags = await attachTags(await attachOwners([row]));
  return withTags[0] ?? null;
}

export async function getUserByHandle(handle: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.handle, handle))
    .limit(1);
  return rows[0] ?? null;
}

export async function findMediaByOwner(
  ownerId: string,
  viewerId?: string,
): Promise<MediaWithTags[]> {
  const visibility =
    ownerId === viewerId
      ? sql`1 = 1`
      : sql`${media.visibility} = 'public'`;

  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.ownerId, ownerId), eq(media.status, "ready"), visibility))
    .orderBy(desc(media.createdAt))
    .limit(120);

  return attachTags(await attachOwners(rows));
}

/** Facet values present in the corpus, for the explore page chip picker. */
export async function getFacetOptions(): Promise<{
  who: Tag[];
  where: Tag[];
  topic: Tag[];
  dates: Array<{ date: string; count: number }>;
}> {
  const allTags = await db
    .select()
    .from(tags)
    .where(sql`${tags.usageCount} > 0 AND ${tags.canonicalTagId} IS NULL`)
    .orderBy(desc(tags.usageCount), tags.label);

  const dateRows = await db
    .select({
      date: media.eventDate,
      count: sql<number>`count(*)`,
    })
    .from(media)
    .where(
      and(
        eq(media.status, "ready"),
        eq(media.visibility, "public"),
        sql`${media.eventDate} IS NOT NULL`,
      ),
    )
    .groupBy(media.eventDate)
    .orderBy(desc(media.eventDate))
    .limit(40);

  return {
    who: allTags.filter((t) => t.facet === "who"),
    where: allTags.filter((t) => t.facet === "where"),
    topic: allTags.filter((t) => t.facet === "topic"),
    dates: dateRows
      .filter((r): r is { date: string; count: number } => r.date !== null)
      .map((r) => ({ date: r.date, count: Number(r.count) })),
  };
}
