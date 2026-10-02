import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { shows, tags } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { isValidEventDate } from "@/lib/tags/normalize";
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
