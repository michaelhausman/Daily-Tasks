import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { artists, performances, shows, type ShowSource } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { isValidDate, slugify, titleKey, venueKey } from "@/lib/text";
import { matchTitle } from "./catalog";

/** One concert and what was played at it, however it was sourced. */
export type ShowInput = {
  artist: string;
  date: string;
  venue?: string;
  city?: string;
  region?: string;
  country?: string;
  tour?: string;
  setlist?: string[];
  setlistUrl?: string;
  source?: ShowSource;
};

export async function resolveArtist(
  name: string,
  mbid?: string,
): Promise<string | null> {
  const nameKey = slugify(name);
  if (!nameKey) return null;

  const existing = await db
    .select()
    .from(artists)
    .where(eq(artists.nameKey, nameKey))
    .limit(1);

  if (existing[0]) {
    if (mbid && !existing[0].mbid) {
      await db.update(artists).set({ mbid }).where(eq(artists.id, existing[0].id));
    }
    return existing[0].id;
  }

  const id = newId();
  await db.insert(artists).values({ id, name: name.trim(), nameKey, mbid: mbid ?? null });
  return id;
}

export type ShowImportResult = {
  showsAdded: number;
  showsUpdated: number;
  performancesWritten: number;
  matchedToWorks: number;
  skipped: string[];
};

/**
 * Load shows and their setlists.
 *
 * Idempotent on artist, venue and day, so re-running a source updates in
 * place. Setlists are replaced wholesale on re-import rather than merged: a
 * corrected setlist is the point of re-importing, and merging would leave the
 * mistake behind alongside the fix.
 *
 * A title that matches no work is still written down, with a null work. That
 * is not an incomplete record — it is the to-do list. Those titles are either
 * covers, which are someone else's money, or works missing from the
 * catalogue, which are yours and currently invisible.
 */
export async function importShows(
  list: ShowInput[],
  opts: { source?: ShowSource; mbid?: string } = {},
): Promise<ShowImportResult> {
  let showsAdded = 0;
  let showsUpdated = 0;
  let performancesWritten = 0;
  let matchedToWorks = 0;
  const skipped: string[] = [];

  for (const input of list) {
    if (!input.artist || !isValidDate(input.date)) {
      skipped.push(`${input.artist ?? "?"} ${input.date ?? "?"} (bad artist or date)`);
      continue;
    }

    const artistId = await resolveArtist(input.artist, opts.mbid);
    if (!artistId) {
      skipped.push(`${input.artist} (unusable name)`);
      continue;
    }

    // A show with no venue still needs a stable key, or every import of it
    // would insert another row. The city stands in; failing that, the date.
    const place = input.venue || input.city || input.date;
    const key = venueKey(place);

    const details = {
      venue: input.venue ?? null,
      venueKey: key,
      city: input.city ?? null,
      region: input.region ?? null,
      country: input.country ?? null,
      tour: input.tour ?? null,
      source: input.source ?? opts.source ?? "manual",
      setlistUrl: input.setlistUrl ?? null,
    };

    const existing = await db
      .select({ id: shows.id })
      .from(shows)
      .where(
        and(
          eq(shows.artistId, artistId),
          eq(shows.venueKey, key),
          eq(shows.eventDate, input.date),
        ),
      )
      .limit(1);

    let showId: string;
    if (existing[0]) {
      showId = existing[0].id;
      await db.update(shows).set(details).where(eq(shows.id, showId));
      showsUpdated++;
    } else {
      showId = newId();
      await db
        .insert(shows)
        .values({ id: showId, artistId, eventDate: input.date, ...details });
      showsAdded++;
    }

    if (!input.setlist) continue;

    await db.delete(performances).where(eq(performances.showId, showId));

    let position = 0;
    for (const rawTitle of input.setlist) {
      const trimmed = rawTitle.trim();
      if (!trimmed) continue;
      const tKey = titleKey(trimmed);
      if (!tKey) continue;

      const workId = await matchTitle(trimmed);
      if (workId) matchedToWorks++;

      await db.insert(performances).values({
        id: newId(),
        showId,
        workId,
        rawTitle: trimmed,
        titleKey: tKey,
        position: position++,
      });
      performancesWritten++;
    }
  }

  return { showsAdded, showsUpdated, performancesWritten, matchedToWorks, skipped };
}

/**
 * Mark a title as somebody else's song, so it stops appearing in the list of
 * works that might be missing from the catalogue.
 */
export async function markNotOurs(key: string): Promise<number> {
  const rows = await db
    .update(performances)
    .set({ notOursAt: new Date() })
    .where(and(eq(performances.titleKey, key), isNull(performances.workId)))
    .returning();
  return rows.length;
}
