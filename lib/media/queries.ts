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

/**
 * `db.execute()` hands back a node-postgres QueryResult (`{ rows }`) under a
 * real server and a plain array under PGlite. Normalizing here keeps callers
 * from caring which engine they're on.
 */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * Normalize a DATE column to `YYYY-MM-DD` regardless of driver parsing.
 *
 * The type parser in lib/db/index.ts means DATE arrives as a string, so the
 * Date branch is a fallback. It reads *local* components deliberately: the only
 * thing that produces a Date here is a driver parsing DATE as local midnight,
 * and reading that back via UTC getters shifts the day backwards for every
 * timezone east of UTC (Tokyo turns 2026-07-24 into 2026-07-23).
 */
function asDateString(value: string | Date): string {
  if (value instanceof Date) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }
  return String(value).slice(0, 10);
}

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
    .select({ n: sql<string>`count(*)` })
    .from(media)
    .where(and(...buildFilters(sel, viewerId)));
  // Postgres COUNT is bigint, which arrives as a string.
  return Number(rows[0]?.n ?? 0);
}

/**
 * Raw shape of a moment row. Types are widened where the two drivers disagree:
 * bigint counts arrive as strings from node-postgres but numbers from PGlite,
 * and timestamps as Date or ISO string depending on the parser.
 */
type MomentRow = {
  who_slug: string;
  who_label: string;
  where_slug: string;
  where_label: string;
  event_date: string | Date;
  media_count: string | number;
  contributor_count: string | number;
  last_upload: string | Date;
  preview_keys: string[] | null;
  kinds: string[] | null;
};

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

  const result = await db.execute(sql`
    SELECT
      wt.slug  AS who_slug,
      wt.label AS who_label,
      rt.slug  AS where_slug,
      rt.label AS where_label,
      m.event_date AS event_date,
      COUNT(DISTINCT m.id)       AS media_count,
      COUNT(DISTINCT m.owner_id) AS contributor_count,
      MAX(m.created_at)          AS last_upload,
      -- Ordered so the previews on a moment card are the newest uploads
      -- rather than whatever order the join happened to produce.
      ARRAY_AGG(DISTINCT m.thumb_key) FILTER (WHERE m.thumb_key IS NOT NULL)
        AS preview_keys,
      ARRAY_AGG(DISTINCT m.kind) AS kinds
    FROM media m
      INNER JOIN media_tags wmt ON wmt.media_id = m.id
      INNER JOIN tags wt        ON wt.id = wmt.tag_id AND wt.facet = 'who'
      INNER JOIN media_tags rmt ON rmt.media_id = m.id
      INNER JOIN tags rt        ON rt.id = rmt.tag_id AND rt.facet = 'where'
    WHERE ${sql.join(conditions, sql` AND `)}
    GROUP BY wt.slug, wt.label, rt.slug, rt.label, m.event_date
    HAVING COUNT(DISTINCT m.id) >= ${minMedia}
    ORDER BY MAX(m.created_at) DESC
    LIMIT ${limit}
  `);

  return rowsOf<MomentRow>(result).map((r) => ({
    who: { slug: r.who_slug, label: r.who_label },
    where: { slug: r.where_slug, label: r.where_label },
    eventDate: asDateString(r.event_date),
    // Postgres COUNT returns bigint, which the driver hands back as a string.
    mediaCount: Number(r.media_count),
    contributorCount: Number(r.contributor_count),
    lastUpload: new Date(r.last_upload).getTime(),
    previewKeys: (r.preview_keys ?? []).slice(0, 4),
    kinds: r.kinds ?? [],
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
