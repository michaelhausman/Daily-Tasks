import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { asDateString, rowsOf } from "@/lib/media/queries";

/**
 * A tour, festival or cruise: the named thing that holds many moments.
 *
 * A moment is one event — one place, one day — which is right for a concert
 * and wrong for anything with extent. A cruise visits several ports over a
 * week; a festival runs several stages over three days; a tour crosses sixty
 * cities. Those are all the same shape: one name, many moments.
 *
 * Nothing new has to be invented to hold it, because the imports already
 * carry it. 465 shows on file name their tour, and one of those names is
 * "JoCo Cruise Crazy 2011" — three cities over five weeks, the exact case the
 * place-and-day model can't express on its own. This gives those names a page.
 *
 * Derived rather than stored as rows, like moments: a tour exists because
 * shows claim to belong to it, so re-importing an artist keeps the pages
 * honest with no second thing to keep in sync.
 */

export type TourMoment = {
  whereSlug: string;
  whereLabel: string;
  eventDate: string;
  city: string | null;
  region: string | null;
  performers: string[];
  mediaCount: number;
};

export type Tour = {
  slug: string;
  label: string;
  performers: Array<{ slug: string; label: string }>;
  firstDate: string;
  lastDate: string;
  cityCount: number;
  mediaCount: number;
  moments: TourMoment[];
};

/** One tour and every moment in it, oldest first — the order it happened. */
export async function findTour(slug: string): Promise<Tour | null> {
  if (!slug) return null;

  const result = await db.execute(sql`
    SELECT
      s.tour,
      s.event_date,
      s.city,
      s.region,
      wt.slug  AS where_slug,
      wt.label AS where_label,
      pt.slug  AS performer_slug,
      pt.label AS performer_label,
      (
        SELECT COUNT(DISTINCT m.id)
        FROM media m
          INNER JOIN media_tags mt ON mt.media_id = m.id
        WHERE mt.tag_id = wt.id
          AND m.event_date = s.event_date
          AND m.status = 'ready'
          AND m.visibility = 'public'
          AND m.hidden_at IS NULL
      ) AS media_count
    FROM shows s
      INNER JOIN tags pt ON pt.id = s.who_tag_id
      INNER JOIN tags wt ON wt.id = s.where_tag_id
    WHERE s.tour_slug = ${slug}
    ORDER BY s.event_date, wt.label, pt.label
  `);

  const rows = rowsOf<{
    tour: string | null;
    event_date: string | Date;
    city: string | null;
    region: string | null;
    where_slug: string;
    where_label: string;
    performer_slug: string;
    performer_label: string;
    media_count: string | number;
  }>(result);

  if (rows.length === 0) return null;

  // Several performers on one night are one moment, the same as everywhere
  // else — a shared bill is one event, not two.
  const moments = new Map<string, TourMoment>();
  const performers = new Map<string, string>();
  const cities = new Set<string>();
  const labels = new Map<string, number>();

  for (const row of rows) {
    const eventDate = asDateString(row.event_date);
    const key = `${row.where_slug}|${eventDate}`;

    const moment =
      moments.get(key) ??
      ({
        whereSlug: row.where_slug,
        whereLabel: row.where_label,
        eventDate,
        city: row.city,
        region: row.region,
        performers: [],
        mediaCount: Number(row.media_count),
      } satisfies TourMoment);
    if (!moment.performers.includes(row.performer_label)) {
      moment.performers.push(row.performer_label);
    }
    moments.set(key, moment);

    performers.set(row.performer_slug, row.performer_label);
    if (row.city) cities.add(row.city.toLowerCase());
    if (row.tour) labels.set(row.tour, (labels.get(row.tour) ?? 0) + 1);
  }

  const ordered = [...moments.values()];
  // Spellings of a tour name can differ between sources; show the commonest.
  const label =
    [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? slug;

  return {
    slug,
    label,
    performers: [...performers.entries()].map(([s, l]) => ({ slug: s, label: l })),
    firstDate: ordered[0].eventDate,
    lastDate: ordered[ordered.length - 1].eventDate,
    cityCount: cities.size,
    mediaCount: ordered.reduce((sum, m) => sum + m.mediaCount, 0),
    moments: ordered,
  };
}

export type TourSummary = {
  slug: string;
  label: string;
  showCount: number;
  firstDate: string;
  lastDate: string;
  cityCount: number;
};

/** A performer's tours, newest first — a career at a readable altitude. */
export async function listToursFor(whoSlug: string): Promise<TourSummary[]> {
  const result = await db.execute(sql`
    SELECT
      s.tour_slug,
      MIN(s.tour)                      AS label,
      COUNT(*)                         AS show_count,
      MIN(s.event_date)                AS first_date,
      MAX(s.event_date)                AS last_date,
      COUNT(DISTINCT lower(s.city))    AS city_count
    FROM shows s
      INNER JOIN tags pt ON pt.id = s.who_tag_id
    WHERE pt.facet = 'who' AND pt.slug = ${whoSlug}
      AND s.tour_slug IS NOT NULL AND s.tour_slug <> ''
    GROUP BY s.tour_slug
    ORDER BY MAX(s.event_date) DESC
  `);

  return rowsOf<{
    tour_slug: string;
    label: string | null;
    show_count: string | number;
    first_date: string | Date;
    last_date: string | Date;
    city_count: string | number;
  }>(result).map((r) => ({
    slug: r.tour_slug,
    label: r.label ?? r.tour_slug,
    showCount: Number(r.show_count),
    firstDate: asDateString(r.first_date),
    lastDate: asDateString(r.last_date),
    cityCount: Number(r.city_count),
  }));
}

/** The tour a given show belongs to, for the link up from a moment page. */
export async function tourAt(
  whereSlug: string,
  eventDate: string,
): Promise<{ slug: string; label: string } | null> {
  const result = await db.execute(sql`
    SELECT s.tour_slug, MIN(s.tour) AS label
    FROM shows s
      INNER JOIN tags wt ON wt.id = s.where_tag_id
    WHERE wt.slug = ${whereSlug}
      AND s.event_date = ${eventDate}
      AND s.tour_slug IS NOT NULL AND s.tour_slug <> ''
    GROUP BY s.tour_slug
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `);

  const row = rowsOf<{ tour_slug: string; label: string | null }>(result)[0];
  return row ? { slug: row.tour_slug, label: row.label ?? row.tour_slug } : null;
}
