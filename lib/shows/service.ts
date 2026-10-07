import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { shows, tags } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { asDateString, rowsOf } from "@/lib/media/queries";
import { isValidEventDate, matchKey } from "@/lib/tags/normalize";
import { resolveTag } from "@/lib/tags/service";

/** One row of a touring history, as the data files in data/shows/ hold it. */
export type ShowInput = {
  date: string;
  venue?: string;
  city: string;
  region?: string;
  tour?: string;
  setlist?: string[];
  setlistUrl?: string;
};

/**
 * The WHERE label a show is filed under: "The Fillmore, San Francisco".
 *
 * Venue names alone are not places. One artist's history has a House of Blues
 * in five cities and a State Theatre in three; tagged by name alone, all five
 * would be one tag and its page would mix five buildings. The city makes the
 * tag mean one room, and the typeahead offers the full label to the next person
 * who types "Fillmore", so they land on it rather than inventing a sibling.
 *
 * A show with no known venue is filed under the city itself.
 */
export function showPlaceLabel(show: Pick<ShowInput, "venue" | "city" | "region">): string {
  if (show.venue) return `${show.venue}, ${show.city}`;
  return show.region ? `${show.city}, ${show.region}` : show.city;
}

/**
 * Load a touring history. Idempotent: a show is identified by performer, place
 * and day, so re-running updates details in place rather than duplicating.
 */
export async function importShows(
  performer: string,
  list: ShowInput[],
): Promise<{ added: number; updated: number; skipped: string[] }> {
  const who = await resolveTag("who", performer);
  if (!who) throw new Error(`Cannot make a performer tag from ${JSON.stringify(performer)}`);

  let added = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const show of list) {
    if (!isValidEventDate(show.date) || !show.city) {
      skipped.push(`${show.date} ${show.venue ?? ""} ${show.city ?? ""}`.trim());
      continue;
    }

    const where = await resolveTag("where", showPlaceLabel(show));
    if (!where) {
      skipped.push(`${show.date} ${showPlaceLabel(show)}`);
      continue;
    }

    const details = {
      city: show.city,
      region: show.region ?? null,
      tour: show.tour ?? null,
      setlistJson: show.setlist?.length ? JSON.stringify(show.setlist) : null,
      setlistUrl: show.setlistUrl ?? null,
    };

    const existing = await db
      .select({ id: shows.id })
      .from(shows)
      .where(
        and(
          eq(shows.whoTagId, who.id),
          eq(shows.whereTagId, where.id),
          eq(shows.eventDate, show.date),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db.update(shows).set(details).where(eq(shows.id, existing[0].id));
      updated++;
    } else {
      await db.insert(shows).values({
        id: newId(),
        whoTagId: who.id,
        whereTagId: where.id,
        eventDate: show.date,
        ...details,
      });
      added++;
    }
  }

  return { added, updated, skipped };
}

export type ShowAtMoment = {
  id: string;
  performer: { slug: string; label: string };
  city: string | null;
  region: string | null;
  tour: string | null;
  setlist: string[];
  setlistUrl: string | null;
};

/** Every show filed under one place on one day — usually one, sometimes a bill. */
export async function findShowsAt(
  whereSlug: string,
  eventDate: string,
): Promise<ShowAtMoment[]> {
  const whoTag = sql.raw("who_tag");

  const rows = await db
    .select({
      id: shows.id,
      performerSlug: sql<string>`${whoTag}.slug`,
      performerLabel: sql<string>`${whoTag}.label`,
      city: shows.city,
      region: shows.region,
      tour: shows.tour,
      setlistJson: shows.setlistJson,
      setlistUrl: shows.setlistUrl,
    })
    .from(shows)
    .innerJoin(tags, eq(tags.id, shows.whereTagId))
    .innerJoin(sql`${tags} AS ${whoTag}`, sql`${whoTag}.id = ${shows.whoTagId}`)
    .where(and(eq(tags.slug, whereSlug), eq(shows.eventDate, eventDate)))
    .orderBy(asc(sql`${whoTag}.label`));

  return rows.map((r) => ({
    id: r.id,
    performer: { slug: r.performerSlug, label: r.performerLabel },
    city: r.city,
    region: r.region,
    tour: r.tour,
    setlist: r.setlistJson ? (JSON.parse(r.setlistJson) as string[]) : [],
    setlistUrl: r.setlistUrl,
  }));
}

/**
 * When two tags merge, shows follow the survivor. A show already filed under
 * the survivor for the same performer and day is the same show, so the
 * duplicate is dropped rather than violating the unique index.
 */
export async function repointShows(fromId: string, intoId: string): Promise<void> {
  for (const [name, otherName] of [
    ["who_tag_id", "where_tag_id"],
    ["where_tag_id", "who_tag_id"],
  ] as const) {
    const column = sql.raw(name);
    const other = sql.raw(otherName);
    await db.execute(sql`
      DELETE FROM shows s
      WHERE s.${column} = ${fromId}
        AND EXISTS (
          SELECT 1 FROM shows t
          WHERE t.${column} = ${intoId}
            AND t.${other} = s.${other}
            AND t.event_date = s.event_date
        )
    `);
    await db.execute(
      sql`UPDATE shows SET ${column} = ${intoId} WHERE ${column} = ${fromId}`,
    );
  }
}

export type ShowListing = {
  eventDate: string;
  where: { slug: string; label: string };
  tour: string | null;
  songCount: number;
  setlistUrl: string | null;
  /** Visible uploads in the moment this show belongs to. */
  mediaCount: number;
};

/**
 * Every show by one performer, newest first, for the by-year history page.
 *
 * Returns rows rather than full moments: a long career is a thousand shows, and
 * the page lists them as compact lines, not cards with previews. The upload
 * count uses the same (place, day) rule as moments, so a show and its photos
 * stay one thing.
 */
export async function listShowsFor(
  whoSlug: string,
): Promise<{ performer: { slug: string; label: string } | null; shows: ShowListing[] }> {
  const performer = await db
    .select({ slug: tags.slug, label: tags.label })
    .from(tags)
    .where(and(eq(tags.facet, "who"), eq(tags.slug, whoSlug)))
    .limit(1);
  if (!performer[0]) return { performer: null, shows: [] };

  const result = await db.execute(sql`
    SELECT
      s.event_date,
      wt.slug  AS where_slug,
      wt.label AS where_label,
      s.tour,
      s.setlist_json,
      s.setlist_url,
      (
        SELECT COUNT(DISTINCT m.id)
        FROM media m
          INNER JOIN media_tags mt ON mt.media_id = m.id
          INNER JOIN tags t        ON t.id = mt.tag_id AND t.facet = 'where'
        WHERE t.slug = wt.slug
          AND m.event_date = s.event_date
          AND m.status = 'ready'
          AND m.visibility = 'public'
          AND m.hidden_at IS NULL
      ) AS media_count
    FROM shows s
      INNER JOIN tags pt ON pt.id = s.who_tag_id
      INNER JOIN tags wt ON wt.id = s.where_tag_id
    WHERE pt.facet = 'who' AND pt.slug = ${whoSlug}
    ORDER BY s.event_date DESC, wt.label
  `);

  const rows = rowsOf<{
    event_date: string | Date;
    where_slug: string;
    where_label: string;
    tour: string | null;
    setlist_json: string | null;
    setlist_url: string | null;
    // COUNT is bigint: a string from node-postgres, a number from PGlite.
    media_count: string | number;
  }>(result);

  return {
    performer: performer[0],
    shows: rows.map((r) => ({
      eventDate: asDateString(r.event_date),
      where: { slug: r.where_slug, label: r.where_label },
      tour: r.tour,
      songCount: r.setlist_json ? (JSON.parse(r.setlist_json) as string[]).length : 0,
      setlistUrl: r.setlist_url,
      mediaCount: Number(r.media_count),
    })),
  };
}

export type ShowMatch = {
  id: string;
  eventDate: string;
  performer: { slug: string; label: string };
  where: { slug: string; label: string };
  city: string | null;
  region: string | null;
  tour: string | null;
  /** Visible uploads already in this moment. */
  mediaCount: number;
};

/**
 * Find shows for someone about to upload.
 *
 * This is the other half of importing a touring history, and the more
 * important half for data quality. Asking "which venue was it?" invites a
 * free-text answer, and a free-text answer is where the curated place list
 * grows siblings — "Wilbur Theater" next to "The Wilbur Theatre, Boston".
 * Asking "which show were you at?" invites a *pick*, and a pick carries the
 * canonical place and date with it, unspellable and unambiguous.
 *
 * A photo almost always knows its own date, so the common case is a date with
 * no text at all: two or three shows happened anywhere in the world that
 * night, and one of them is nearly always theirs.
 */
export async function searchShows(opts: {
  query?: string;
  date?: string;
  limit?: number;
}): Promise<ShowMatch[]> {
  const limit = Math.min(opts.limit ?? 12, 50);
  const key = opts.query ? matchKey(opts.query) : "";
  const date = opts.date && isValidEventDate(opts.date) ? opts.date : null;

  // Without either, there is nothing to narrow a few thousand shows by.
  if (!key && !date) return [];

  const conditions: SQL[] = [];
  if (date) conditions.push(sql`s.event_date = ${date}`);
  if (key) {
    conditions.push(sql`(
      pt.match_key LIKE ${`%${key}%`}
      OR wt.match_key LIKE ${`%${key}%`}
      OR lower(s.city) LIKE ${`%${key}%`}
    )`);
  }

  const result = await db.execute(sql`
    SELECT
      s.id,
      s.event_date,
      pt.slug  AS performer_slug,
      pt.label AS performer_label,
      wt.slug  AS where_slug,
      wt.label AS where_label,
      s.city,
      s.region,
      s.tour,
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
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY s.event_date DESC, pt.label
    LIMIT ${limit}
  `);

  return rowsOf<{
    id: string;
    event_date: string | Date;
    performer_slug: string;
    performer_label: string;
    where_slug: string;
    where_label: string;
    city: string | null;
    region: string | null;
    tour: string | null;
    media_count: string | number;
  }>(result).map((r) => ({
    id: r.id,
    eventDate: asDateString(r.event_date),
    performer: { slug: r.performer_slug, label: r.performer_label },
    where: { slug: r.where_slug, label: r.where_label },
    city: r.city,
    region: r.region,
    tour: r.tour,
    mediaCount: Number(r.media_count),
  }));
}

/** How many known shows a performer has — for linking to their history. */
export async function countShowsFor(whoSlug: string): Promise<number> {
  const rows = await db
    .select({ n: sql<string>`count(*)` })
    .from(shows)
    .innerJoin(tags, eq(tags.id, shows.whoTagId))
    .where(and(eq(tags.facet, "who"), eq(tags.slug, whoSlug)));
  return Number(rows[0]?.n ?? 0);
}
