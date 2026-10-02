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
export function rowsOf<T>(result: unknown): T[] {
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
export function asDateString(value: string | Date): string {
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

  /**
   * Hidden media is excluded from every listing, for everybody — including its
   * owner. A moderator hiding something and the uploader still seeing it in
   * their own feed would be a confusing half-measure; they see it on the item's
   * own page instead, with an explanation.
   *
   * Suspending an account hides everything it posted by the same mechanism, so
   * there's only one rule to reason about here.
   */
  filters.push(sql`${media.hiddenAt} IS NULL`);

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
  where_slug: string;
  where_label: string;
  event_date: string | Date;
  media_count: string | number;
  contributor_count: string | number;
  last_upload: string | Date | null;
  preview_keys: string[] | null;
  kinds: string[] | null;
  performers: string[] | null;
  tour: string | null;
  is_show: boolean;
};

export type Moment = {
  where: { slug: string; label: string };
  eventDate: string;
  mediaCount: number;
  contributorCount: number;
  /** Epoch ms of the newest upload, or null for a show nobody has posted from. */
  lastUpload: number | null;
  previewKeys: string[];
  kinds: string[];
  /** Who-tag labels present in this moment, for the "featuring" line. */
  performers: string[];
  /** Set when the moment is a known show, from the imported touring history. */
  tour: string | null;
  isShow: boolean;
};

/**
 * A Moment is a place on a day: CBGB on 12 June 1970, the Eau Claire festival
 * on 24 July 2026. Usually nobody creates one — it's the observation that people
 * independently tagged uploads with the same venue and the same date, so those
 * uploads are pictures of one occasion and belong on one page.
 *
 * The performer is deliberately *not* part of a moment's identity. It used to
 * be, and that was wrong for two reasons: a photo of an empty CBGB storefront
 * has no performer and would never have pooled with anything, and a festival
 * day with forty bands was forty separate moments instead of one afternoon.
 * Performers live inside a moment as chips you can filter by, which keeps the
 * per-artist view a click away without fragmenting the place-and-day pool.
 *
 * Deriving it from a GROUP BY instead of storing it means a moment springs into
 * existence the instant the second person tags correctly, with no backfill and
 * nothing to keep in sync.
 *
 * The exception is a known show (see `shows` in schema.ts), which is a moment
 * before anyone has posted. Both sources key on the same (where slug, date), so
 * a show and the uploads from it are one moment, joined rather than duplicated.
 * Empty shows are left out unless `includeEmpty` asks for them: there are
 * hundreds, and a home page of empty cards would bury the moments people have
 * actually filled.
 */
export async function findMoments(
  opts: {
    limit?: number;
    where?: string;
    eventDate?: string;
    /** Performer slugs; a moment matches if any upload or show in it has one. */
    who?: string[];
    minMedia?: number;
    /** Also return known shows that have no uploads yet. */
    includeEmpty?: boolean;
    /** Newest upload first (the default), or most recent show date first. */
    orderBy?: "activity" | "date";
    /** Restrict to these (whereSlug, date) pairs — used by the following feed. */
    keys?: Array<{ whereSlug: string; eventDate: string }>;
  } = {},
): Promise<Moment[]> {
  const {
    limit = 24,
    where,
    eventDate,
    who,
    minMedia = 1,
    includeEmpty = false,
    orderBy = "activity",
    keys,
  } = opts;

  if (keys && keys.length === 0) return [];

  // The same place/day narrowing applies to both sources, and is pushed inside
  // each CTE so neither aggregates rows the outer filter would throw away.
  function keyConditions(slug: SQL, day: SQL): SQL[] {
    const out: SQL[] = [];
    if (where) out.push(sql`${slug} = ${where}`);
    if (eventDate) out.push(sql`${day} = ${eventDate}`);
    if (keys) {
      out.push(
        sql`(${sql.join(
          keys.map((k) => sql`(${slug} = ${k.whereSlug} AND ${day} = ${k.eventDate})`),
          sql` OR `,
        )})`,
      );
    }
    return out;
  }

  const pooledConditions: SQL[] = [
    sql`m.status = 'ready'`,
    sql`m.visibility = 'public'`,
    sql`m.hidden_at IS NULL`,
    sql`m.event_date IS NOT NULL`,
    ...keyConditions(sql`rt.slug`, sql`m.event_date`),
  ];
  const bookedConditions: SQL[] = [
    sql`1 = 1`,
    ...keyConditions(sql`wt.slug`, sql`s.event_date`),
  ];

  const outer: SQL[] = [
    includeEmpty
      ? sql`(mo.media_count >= ${minMedia} OR mo.is_show)`
      : sql`mo.media_count >= ${minMedia}`,
  ];
  if (who && who.length > 0) {
    const slugs = sql.join(
      who.map((w) => sql`${w}`),
      sql`, `,
    );
    outer.push(sql`(
      EXISTS (
        SELECT 1 FROM media m3
          INNER JOIN media_tags mt3  ON mt3.media_id = m3.id
          INNER JOIN tags t3         ON t3.id = mt3.tag_id AND t3.facet = 'who'
          INNER JOIN media_tags rmt3 ON rmt3.media_id = m3.id
          INNER JOIN tags rt3        ON rt3.id = rmt3.tag_id AND rt3.facet = 'where'
        WHERE m3.status = 'ready' AND m3.visibility = 'public' AND m3.hidden_at IS NULL
          AND rt3.slug = mo.where_slug AND m3.event_date = mo.event_date
          AND t3.slug IN (${slugs})
      )
      OR EXISTS (
        SELECT 1 FROM shows s3
          INNER JOIN tags pt3 ON pt3.id = s3.who_tag_id
          INNER JOIN tags wt3 ON wt3.id = s3.where_tag_id
        WHERE wt3.slug = mo.where_slug AND s3.event_date = mo.event_date
          AND pt3.slug IN (${slugs})
      )
    )`);
  }

  const order =
    orderBy === "date"
      ? sql`mo.event_date DESC`
      : sql`mo.last_upload DESC NULLS LAST, mo.event_date DESC`;

  const result = await db.execute(sql`
    WITH pooled AS (
      SELECT
        rt.slug  AS where_slug,
        rt.label AS where_label,
        m.event_date AS event_date,
        COUNT(DISTINCT m.id)       AS media_count,
        COUNT(DISTINCT m.owner_id) AS contributor_count,
        MAX(m.created_at)          AS last_upload,
        ARRAY_AGG(DISTINCT m.thumb_key) FILTER (WHERE m.thumb_key IS NOT NULL)
          AS preview_keys,
        ARRAY_AGG(DISTINCT m.kind) AS kinds
      FROM media m
        INNER JOIN media_tags rmt ON rmt.media_id = m.id
        INNER JOIN tags rt        ON rt.id = rmt.tag_id AND rt.facet = 'where'
      WHERE ${sql.join(pooledConditions, sql` AND `)}
      GROUP BY rt.slug, rt.label, m.event_date
    ),
    booked AS (
      SELECT
        wt.slug  AS where_slug,
        wt.label AS where_label,
        s.event_date AS event_date,
        MIN(s.tour) AS tour
      FROM shows s
        INNER JOIN tags wt ON wt.id = s.where_tag_id
      WHERE ${sql.join(bookedConditions, sql` AND `)}
      GROUP BY wt.slug, wt.label, s.event_date
    ),
    mo AS (
      SELECT
        COALESCE(p.where_slug, b.where_slug)   AS where_slug,
        COALESCE(p.where_label, b.where_label) AS where_label,
        COALESCE(p.event_date, b.event_date)   AS event_date,
        COALESCE(p.media_count, 0)       AS media_count,
        COALESCE(p.contributor_count, 0) AS contributor_count,
        p.last_upload,
        p.preview_keys,
        p.kinds,
        b.tour,
        (b.where_slug IS NOT NULL) AS is_show
      FROM pooled p
        FULL OUTER JOIN booked b
          ON b.where_slug = p.where_slug AND b.event_date = p.event_date
    )
    SELECT
      mo.*,
      -- Performers are a property of the moment's contents, not its identity,
      -- so they're gathered with a correlated subquery rather than a join that
      -- would multiply the grouped rows: whoever was tagged in an upload, plus
      -- whoever the show was billed to.
      (
        SELECT ARRAY_AGG(DISTINCT x.label) FROM (
          SELECT t2.label
          FROM media m2
            INNER JOIN media_tags mt2  ON mt2.media_id = m2.id
            INNER JOIN tags t2         ON t2.id = mt2.tag_id AND t2.facet = 'who'
            INNER JOIN media_tags rmt2 ON rmt2.media_id = m2.id
            INNER JOIN tags rt2        ON rt2.id = rmt2.tag_id AND rt2.facet = 'where'
          WHERE m2.status = 'ready'
            AND m2.visibility = 'public'
            AND m2.hidden_at IS NULL
            AND rt2.slug = mo.where_slug
            AND m2.event_date = mo.event_date
          UNION
          SELECT pt2.label
          FROM shows s2
            INNER JOIN tags pt2 ON pt2.id = s2.who_tag_id
            INNER JOIN tags wt2 ON wt2.id = s2.where_tag_id
          WHERE wt2.slug = mo.where_slug
            AND s2.event_date = mo.event_date
        ) x
      ) AS performers
    FROM mo
    WHERE ${sql.join(outer, sql` AND `)}
    ORDER BY ${order}
    LIMIT ${limit}
  `);

  return rowsOf<MomentRow>(result).map((r) => ({
    where: { slug: r.where_slug, label: r.where_label },
    eventDate: asDateString(r.event_date),
    // Postgres COUNT returns bigint, which the driver hands back as a string.
    mediaCount: Number(r.media_count),
    contributorCount: Number(r.contributor_count),
    lastUpload: r.last_upload ? new Date(r.last_upload).getTime() : null,
    previewKeys: (r.preview_keys ?? []).slice(0, 4),
    kinds: r.kinds ?? [],
    performers: r.performers ?? [],
    tour: r.tour,
    isShow: Boolean(r.is_show),
  }));
}

export async function getMediaById(
  id: string,
  viewerId?: string,
  viewerIsAdmin = false,
): Promise<MediaWithTags | null> {
  const rows = await db.select().from(media).where(eq(media.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;

  const isOwner = row.ownerId === viewerId;

  // Unlisted is link-shareable by design, so only `processing`/`failed` items
  // are owner-gated here.
  if (row.status !== "ready" && !isOwner) return null;

  /**
   * Hidden media 404s for the public, but stays reachable for its owner and for
   * moderators. The owner needs somewhere to find out it was hidden and why —
   * removing something silently and leaving no trace is how people conclude the
   * site is broken rather than that they broke a rule.
   */
  if (row.hiddenAt && !isOwner && !viewerIsAdmin) return null;

  const withTags = await attachTags(await attachOwners([row]));
  return withTags[0] ?? null;
}

/**
 * Hydrate a list of ids, preserving the order given. The following feed decides
 * *which* media to show with its own query, then needs the full rows.
 */
export async function getMediaByIds(
  ids: string[],
  viewerId?: string,
): Promise<MediaWithTags[]> {
  if (ids.length === 0) return [];

  const rows = await db
    .select()
    .from(media)
    .where(
      and(
        inArray(media.id, ids),
        eq(media.status, "ready"),
        sql`${media.hiddenAt} IS NULL`,
        viewerId
          ? sql`(${media.visibility} = 'public' OR ${media.ownerId} = ${viewerId})`
          : sql`${media.visibility} = 'public'`,
      ),
    );

  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return attachTags(await attachOwners(rows));
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
    .where(
      and(
        eq(media.ownerId, ownerId),
        eq(media.status, "ready"),
        sql`${media.hiddenAt} IS NULL`,
        visibility,
      ),
    )
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
    // Performers with a known show count as in use even before their first
    // upload, so an imported artist is pickable from day one. Places don't get
    // the same treatment: one touring history is hundreds of venues, which
    // would bury the picker — they're reached through the performer instead.
    .where(
      sql`${tags.canonicalTagId} IS NULL AND (
        ${tags.usageCount} > 0
        OR (${tags.facet} = 'who' AND EXISTS (
          SELECT 1 FROM shows s WHERE s.who_tag_id = ${tags.id}
        ))
      )`,
    )
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
        sql`${media.hiddenAt} IS NULL`,
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
