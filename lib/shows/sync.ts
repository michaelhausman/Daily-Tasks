import { and, desc, eq, gte, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  showImports,
  shows,
  tags,
  venueDecisions,
  type ImportStatus,
  type ShowImport,
} from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { asDateString, rowsOf } from "@/lib/media/queries";
import { matchKey } from "@/lib/tags/normalize";
import { SETLISTFM_API_KEY, SHOW_REFRESH_DAYS } from "@/lib/config";
import {
  alignVenues,
  fetchSetlists,
  findArtist,
  mergeSameShow,
  toShowInput,
  type SetlistFmArtist,
  type VenueDecision,
} from "./setlistfm";
import { importShows, showPlaceLabel, type ShowInput } from "./service";

/**
 * Importing a touring history from the admin pages, rather than from a laptop
 * running `npm run fetch:setlistfm`.
 *
 * The script and this module share every piece of the pipeline — fetching,
 * venue alignment, importing — because lib/shows/setlistfm.ts deliberately
 * holds no database or filesystem code. What is different here is only *when*
 * the work happens: the script blocks a terminal for a minute, which a web
 * request cannot do, so the job runs detached and reports progress through a
 * row in `show_imports`.
 */

/** Statuses that mean a job still intends to do more work. */
const ACTIVE: ImportStatus[] = ["queued", "fetching", "importing"];

/**
 * How long a job may go without touching its row before it's presumed dead.
 * Generous, because a single page of a slow setlist.fm response plus the final
 * import of a thousand shows can both be quiet for a while.
 */
const STALE_AFTER_MS = 5 * 60_000;

/**
 * Jobs this process is running. The DB row says what a job *was* doing; only
 * the process knows it is still doing it, and the two disagree whenever a
 * container restarts mid-fetch — which is what `heartbeatAt` resolves.
 */
const RUNNING = new Set<string>();

export function syncAvailable(): boolean {
  return SETLISTFM_API_KEY !== null;
}

function isStale(job: Pick<ShowImport, "heartbeatAt">): boolean {
  return Date.now() - new Date(job.heartbeatAt).getTime() > STALE_AFTER_MS;
}

export type ImportJob = ShowImport & { stale: boolean };

function decorate(job: ShowImport): ImportJob {
  return { ...job, stale: ACTIVE.includes(job.status) && isStale(job) };
}

/**
 * The job currently holding the import slot, if any.
 *
 * Only one runs at a time, for two reasons: setlist.fm's free tier allows
 * roughly two requests a second for the whole site, and the pacing that
 * respects it lives in a module-level variable in setlistfm.ts, which two
 * concurrent fetches would each ignore.
 */
export async function activeImport(): Promise<ImportJob | null> {
  const rows = await db
    .select()
    .from(showImports)
    .where(
      or(...ACTIVE.map((s) => eq(showImports.status, s))),
    )
    .orderBy(desc(showImports.createdAt))
    .limit(1);

  const job = rows[0];
  if (!job) return null;
  return isStale(job) ? null : decorate(job);
}

export async function recentImports(limit = 8): Promise<ImportJob[]> {
  const rows = await db
    .select()
    .from(showImports)
    .orderBy(desc(showImports.createdAt))
    .limit(limit);
  return rows.map(decorate);
}

export async function getImport(id: string): Promise<ImportJob | null> {
  const rows = await db
    .select()
    .from(showImports)
    .where(eq(showImports.id, id))
    .limit(1);
  return rows[0] ? decorate(rows[0]) : null;
}

export type StartResult =
  | { ok: true; jobId: string; performer: string }
  /** The name matches more than one artist; the caller has to pick. */
  | { ok: false; choices: SetlistFmArtist[] }
  | { ok: false; error: string };

/**
 * Look the artist up, then start the import in the background.
 *
 * The lookup is awaited because it's a single fast request and its result is
 * what the caller needs to see — including the case where two bands share a
 * name, which must be a question rather than a guess: filing one band's shows
 * under the other's tag is the kind of error nobody notices until a fan does.
 */
export async function startArtistSync(opts: {
  name: string;
  mbid?: string;
  /** Null for the weekly refresh, which nobody pressed a button to start. */
  userId: string | null;
}): Promise<StartResult> {
  const apiKey = SETLISTFM_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error:
        "SETLISTFM_API_KEY isn't set on the server, so imports can't run here.",
    };
  }

  const name = opts.name.trim();
  if (!name) return { ok: false, error: "Type an artist name." };

  const busy = await activeImport();
  if (busy) {
    return {
      ok: false,
      error: `Already importing ${busy.performer}. One at a time — setlist.fm's rate limit is shared across the whole site.`,
    };
  }

  let matches: SetlistFmArtist[];
  try {
    matches = await findArtist(apiKey, name);
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }

  if (matches.length === 0) {
    return {
      ok: false,
      error: `setlist.fm has no artist named exactly "${name}".`,
    };
  }

  const artist = opts.mbid
    ? matches.find((a) => a.mbid === opts.mbid)
    : matches.length === 1
      ? matches[0]
      : undefined;

  if (!artist) {
    if (opts.mbid) return { ok: false, error: "That artist is no longer listed." };
    return { ok: false, choices: matches };
  }

  const jobId = newId();
  await db.insert(showImports).values({
    id: jobId,
    performer: artist.name,
    mbid: artist.mbid,
    status: "queued",
    startedBy: opts.userId,
  });

  // Detached on purpose: this returns in milliseconds and the fetch runs for
  // minutes. Nothing awaits the promise, so its rejection is handled here
  // rather than becoming an unhandled rejection that takes the server down.
  void runSync(jobId, apiKey, artist).catch(async (error) => {
    await finish(jobId, "failed", { error: messageOf(error) });
  });

  return { ok: true, jobId, performer: artist.name };
}

/** Re-run an import that died, or whose row says it's running but isn't. */
export async function retryImport(
  id: string,
  userId: string,
): Promise<StartResult> {
  const job = await getImport(id);
  if (!job) return { ok: false, error: "No such import." };
  return startArtistSync({
    name: job.performer,
    mbid: job.mbid ?? undefined,
    userId,
  });
}

async function touch(
  id: string,
  patch: Partial<Record<"page" | "pages" | "fetched" | "aligned", number>> & {
    status?: ImportStatus;
  },
): Promise<void> {
  await db
    .update(showImports)
    .set({ ...patch, heartbeatAt: new Date() })
    .where(eq(showImports.id, id));
}

async function finish(
  id: string,
  status: "done" | "failed",
  patch: {
    error?: string;
    added?: number;
    updated?: number;
    skipped?: number;
    aligned?: number;
  },
): Promise<void> {
  RUNNING.delete(id);
  await db
    .update(showImports)
    .set({ ...patch, status, heartbeatAt: new Date(), finishedAt: new Date() })
    .where(eq(showImports.id, id));
}

async function runSync(
  jobId: string,
  apiKey: string,
  artist: SetlistFmArtist,
): Promise<void> {
  RUNNING.add(jobId);
  try {
    await touch(jobId, { status: "fetching" });

    const setlists = await fetchSetlists(apiKey, artist.mbid, (page, pages) => {
      // Fire-and-forget: pages are 600ms apart, so each write lands long
      // before the next one, and a dropped progress update costs nothing.
      void touch(jobId, { page, pages });
    });

    const usable = setlists
      .map(toShowInput)
      .filter((s): s is ShowInput => s !== null);

    await touch(jobId, { status: "importing", fetched: setlists.length });

    // Align against what the database already holds, not against the data
    // files: the database is what the live pages are built from, and it
    // includes everything imported from here as well as from the scripts.
    const dates = usable.map((s) => s.date).sort();
    const existing =
      dates.length > 0
        ? await existingShowsBetween(dates[0], dates[dates.length - 1])
        : [];

    const { rows: aligned, report } = alignVenues(
      usable,
      existing,
      await storedVenueDecisions(),
    );
    const list = mergeSameShow(aligned);

    const { added, updated, skipped } = await importShows(artist.name, list);

    await finish(jobId, "done", {
      added,
      updated,
      skipped: skipped.length,
      aligned: report.aligned.length,
    });
  } catch (error) {
    await finish(jobId, "failed", { error: messageOf(error) });
  }
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/**
 * Shows already on file in a date window, in the shape `alignVenues` compares
 * against.
 *
 * The venue is recovered from the place tag's label rather than stored twice:
 * `showPlaceLabel` built it as "Venue, City", so a label that ends with the
 * city has a venue in front of it, and one that doesn't is a show filed under
 * its city alone — which has no venue name to align and is skipped.
 */
async function existingShowsBetween(
  from: string,
  to: string,
): Promise<ShowInput[]> {
  const rows = await db
    .select({
      date: shows.eventDate,
      city: shows.city,
      region: shows.region,
      label: tags.label,
    })
    .from(shows)
    .innerJoin(tags, eq(tags.id, shows.whereTagId))
    .where(and(gte(shows.eventDate, from), lte(shows.eventDate, to)));

  const out: ShowInput[] = [];
  for (const row of rows) {
    if (!row.city) continue;
    const venue = venuePartOf(row.label, row.city);
    if (!venue) continue;
    out.push({
      date: asDateString(row.date),
      venue,
      city: row.city,
      region: row.region ?? undefined,
    });
  }
  return out;
}

/**
 * The venue half of a place label, or null when the label is a city rather
 * than a room in one.
 */
export function venuePartOf(label: string, city: string): string | null {
  const suffix = `, ${city}`;
  if (label.length <= suffix.length) return null;
  if (label.slice(-suffix.length).toLowerCase() !== suffix.toLowerCase()) {
    return null;
  }
  return label.slice(0, -suffix.length);
}

export async function storedVenueDecisions(): Promise<VenueDecision[]> {
  const rows = await db.select().from(venueDecisions);
  return rows.map((r) => ({
    city: r.city,
    names: JSON.parse(r.namesJson) as string[],
    date: r.eventDate ?? undefined,
    different: r.different,
    note: r.note ?? undefined,
  }));
}

export type VenueQuestion = {
  city: string;
  eventDate: string;
  places: Array<{
    tagId: string;
    label: string;
    /** The label without the city — what the two spellings actually differ in. */
    venue: string;
    showCount: number;
    performers: string[];
  }>;
};

/**
 * Nights where one city holds shows under two different place tags.
 *
 * Derived from the shows themselves rather than stored when an import reports
 * them, so the list maintains itself: merge the two tags, or record that they
 * are different places, and the question stops being asked. It catches
 * collisions from any source — the admin importer, the scripts, or two people
 * typing a venue slightly differently.
 */
export async function venueQuestions(limit = 40): Promise<VenueQuestion[]> {
  const result = await db.execute(sql`
    WITH placed AS (
      SELECT
        s.event_date,
        s.city,
        lower(s.city) AS city_key,
        wt.id    AS tag_id,
        wt.label AS tag_label,
        pt.label AS performer
      FROM shows s
        INNER JOIN tags wt ON wt.id = s.where_tag_id
        INNER JOIN tags pt ON pt.id = s.who_tag_id
      WHERE s.city IS NOT NULL
    ),
    collided AS (
      SELECT city_key, event_date
      FROM placed
      GROUP BY city_key, event_date
      HAVING COUNT(DISTINCT tag_id) > 1
    )
    SELECT
      p.event_date,
      p.city,
      p.tag_id,
      p.tag_label,
      p.performer,
      (SELECT COUNT(*) FROM shows s2 WHERE s2.where_tag_id = p.tag_id) AS show_count
    FROM placed p
      INNER JOIN collided c
        ON c.city_key = p.city_key AND c.event_date = p.event_date
    ORDER BY p.event_date DESC, p.tag_label, p.performer
  `);

  const rows = rowsOf<{
    event_date: string | Date;
    city: string;
    tag_id: string;
    tag_label: string;
    performer: string;
    show_count: string | number;
  }>(result);

  const byNight = new Map<string, VenueQuestion>();
  for (const row of rows) {
    const eventDate = asDateString(row.event_date);
    const key = `${row.city.toLowerCase()}|${eventDate}`;
    const question =
      byNight.get(key) ?? { city: row.city, eventDate, places: [] };
    byNight.set(key, question);

    const venue = venuePartOf(row.tag_label, row.city);
    // A show filed under its city has no venue spelling to reconcile.
    if (!venue) continue;

    let place = question.places.find((p) => p.tagId === row.tag_id);
    if (!place) {
      place = {
        tagId: row.tag_id,
        label: row.tag_label,
        venue,
        showCount: Number(row.show_count),
        performers: [],
      };
      question.places.push(place);
    }
    if (!place.performers.includes(row.performer)) {
      place.performers.push(row.performer);
    }
  }

  const decisions = await storedVenueDecisions();
  const open: VenueQuestion[] = [];
  for (const question of byNight.values()) {
    // One place left after dropping city-only rows is not a collision.
    if (question.places.length < 2) continue;
    if (answered(question, decisions)) continue;
    // Biggest first: merging the stray spelling into the established one is
    // almost always the right direction, so show that one as the target.
    question.places.sort((a, b) => b.showCount - a.showCount);
    open.push(question);
    if (open.length >= limit) break;
  }
  return open;
}

/** True when some decision already covers every spelling in this question. */
function answered(
  question: VenueQuestion,
  decisions: VenueDecision[],
): boolean {
  const venues = question.places.map((p) => p.venue);
  return decisions.some(
    (d) =>
      d.city.toLowerCase() === question.city.toLowerCase() &&
      (!d.date || d.date === question.eventDate) &&
      venues.every((v) => d.names.includes(v)),
  );
}

/**
 * Record a call on two venue names, so no future import asks again.
 *
 * `different` is scoped to the one night by default — two rooms in a city only
 * coincide on the date they both had a show, and saying "these names are never
 * the same place" is a stronger claim than the question asked.
 */
export async function recordVenueDecision(opts: {
  city: string;
  names: string[];
  eventDate?: string;
  different: boolean;
  note?: string;
  userId: string;
}): Promise<void> {
  await db.insert(venueDecisions).values({
    id: newId(),
    city: opts.city,
    namesJson: JSON.stringify(opts.names),
    eventDate: opts.different ? (opts.eventDate ?? null) : null,
    different: opts.different,
    note: opts.note ?? null,
    decidedBy: opts.userId,
  });
}

export async function clearVenueDecisions(city: string, names: string[]): Promise<void> {
  const rows = await db
    .select()
    .from(venueDecisions)
    .where(eq(venueDecisions.city, city));
  const ids = rows
    .filter((r) => {
      const stored = JSON.parse(r.namesJson) as string[];
      return names.every((n) => stored.includes(n));
    })
    .map((r) => r.id);
  for (const id of ids) {
    await db.delete(venueDecisions).where(eq(venueDecisions.id, id));
  }
}

export type PlaceCluster = {
  city: string;
  places: Array<{
    tagId: string;
    label: string;
    venue: string;
    showCount: number;
    uploadCount: number;
  }>;
};

/**
 * Place tags in one city that look like the same room, whatever the dates.
 *
 * The venue questions above only fire when two spellings collide on the same
 * night, which is a safe signal but a narrow one: two spellings of one room
 * that never happen to share a date are invisible to it, and a third artist's
 * touring history is exactly how that happens. This asks the same question
 * from the other direction — comparing names within a city rather than within
 * a night — using the same folding the importer uses, so "The Birchmere" and
 * "Birchmere" match whether or not anyone played both.
 *
 * Only ever a prompt. Two rooms really can be "Theatre A" and "Theater B".
 */
export async function duplicatePlaces(limit = 40): Promise<PlaceCluster[]> {
  const result = await db.execute(sql`
    SELECT
      t.id,
      t.label,
      t.usage_count,
      (SELECT COUNT(*) FROM shows s WHERE s.where_tag_id = t.id) AS show_count
    FROM tags t
    WHERE t.facet = 'where' AND t.canonical_tag_id IS NULL
  `);

  const rows = rowsOf<{
    id: string;
    label: string;
    usage_count: number;
    show_count: string | number;
  }>(result);

  // City is the last comma-separated piece, which is how showPlaceLabel builds
  // these and how people type them. A label with no comma is a city itself.
  const byCity = new Map<string, PlaceCluster["places"]>();
  for (const row of rows) {
    const comma = row.label.lastIndexOf(", ");
    if (comma < 1) continue;
    const city = row.label.slice(comma + 2).trim();
    const venue = row.label.slice(0, comma).trim();
    if (!city || !venue) continue;

    const list = byCity.get(city.toLowerCase()) ?? [];
    list.push({
      tagId: row.id,
      label: row.label,
      venue,
      showCount: Number(row.show_count),
      uploadCount: row.usage_count,
    });
    byCity.set(city.toLowerCase(), list);
  }

  const decisions = await storedVenueDecisions();
  const clusters: PlaceCluster[] = [];

  for (const places of byCity.values()) {
    if (places.length < 2) continue;
    const city = places[0].label.slice(places[0].label.lastIndexOf(", ") + 2);

    // Compare the venue halves: the city is common to all of them here, and
    // leaving it in drowns out the difference that matters.
    const keys = new Map(places.map((p) => [p.tagId, matchKey(p.venue)]));
    const used = new Set<string>();

    for (const place of places) {
      if (used.has(place.tagId)) continue;
      const key = keys.get(place.tagId)!;
      const group = places.filter(
        (other) => !used.has(other.tagId) && looksLikeSamePlace(key, keys.get(other.tagId)!),
      );
      if (group.length < 2) continue;
      for (const g of group) used.add(g.tagId);

      const cluster: PlaceCluster = {
        city,
        places: group.sort((a, b) => b.showCount - a.showCount),
      };
      if (clusterAnswered(cluster, decisions)) continue;
      clusters.push(cluster);
      if (clusters.length >= limit) return clusters;
    }
  }

  return clusters;
}

/** Equal once folded, or one name contained in the other. */
function looksLikeSamePlace(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  // Long enough that containment isn't a coincidence — the same threshold
  // alignVenues uses when matching an import against what's on file.
  return short.length >= 8 && ` ${long} `.includes(` ${short} `);
}

function clusterAnswered(
  cluster: PlaceCluster,
  decisions: VenueDecision[],
): boolean {
  const venues = cluster.places.map((p) => p.venue);
  return decisions.some(
    (d) =>
      d.city.toLowerCase() === cluster.city.toLowerCase() &&
      venues.every((v) => d.names.includes(v)),
  );
}

export type InventedPlace = {
  tagId: string;
  slug: string;
  label: string;
  uploadCount: number;
  createdAt: Date;
};

/**
 * Places someone made up while uploading — no imported show stands behind
 * them.
 *
 * Most will be legitimate: a club that closed in 1979, a festival field, a
 * friend's porch. The point isn't to prevent those, it's to see them. A venue
 * invented next to one that already exists is the failure mode that hides
 * best, because everything looks fine to the person who caused it.
 */
export async function inventedPlaces(limit = 30): Promise<InventedPlace[]> {
  const rows = await db
    .select({
      tagId: tags.id,
      slug: tags.slug,
      label: tags.label,
      uploadCount: tags.usageCount,
      createdAt: tags.createdAt,
    })
    .from(tags)
    .where(
      sql`${tags.facet} = 'where'
        AND ${tags.canonicalTagId} IS NULL
        AND ${tags.reviewedAt} IS NULL
        AND ${tags.usageCount} > 0
        AND NOT EXISTS (SELECT 1 FROM shows s WHERE s.where_tag_id = ${tags.id})`,
    )
    .orderBy(desc(tags.createdAt))
    .limit(limit);

  return rows;
}

export async function markPlaceReviewed(tagId: string): Promise<void> {
  await db
    .update(tags)
    .set({ reviewedAt: new Date() })
    .where(eq(tags.id, tagId));
}

export type LoadedPerformer = {
  slug: string;
  label: string;
  showCount: number;
  firstDate: string;
  lastDate: string;
  withSetlists: number;
};

/** Performers who already have shows, for one-tap re-syncing. */
export async function loadedPerformers(): Promise<LoadedPerformer[]> {
  const result = await db.execute(sql`
    SELECT
      pt.slug,
      pt.label,
      COUNT(*)              AS show_count,
      MIN(s.event_date)     AS first_date,
      MAX(s.event_date)     AS last_date,
      COUNT(s.setlist_json) AS with_setlists
    FROM shows s
      INNER JOIN tags pt ON pt.id = s.who_tag_id
    GROUP BY pt.slug, pt.label
    ORDER BY COUNT(*) DESC
  `);

  return rowsOf<{
    slug: string;
    label: string;
    show_count: string | number;
    first_date: string | Date;
    last_date: string | Date;
    with_setlists: string | number;
  }>(result).map((r) => ({
    slug: r.slug,
    label: r.label,
    showCount: Number(r.show_count),
    firstDate: asDateString(r.first_date),
    lastDate: asDateString(r.last_date),
    withSetlists: Number(r.with_setlists),
  }));
}

/**
 * Don't re-attempt the same performer faster than this, whatever happened.
 * A refresh that fails for a reason that won't fix itself — a renamed artist,
 * a revoked key — shouldn't turn into hourly API calls forever.
 */
const RETRY_AFTER_MS = 6 * 60 * 60_000;

/**
 * Consecutive failures before a performer is left alone. Three is enough to
 * ride out setlist.fm being down and few enough that a real problem surfaces
 * on the admin page while it still means something.
 */
const GIVE_UP_AFTER = 3;

export type RefreshState = {
  label: string;
  mbid: string | null;
  lastSuccess: Date | null;
  lastAttempt: Date | null;
  /** Failures since the last success — at GIVE_UP_AFTER, auto-refresh stops. */
  failures: number;
  dueAt: Date | null;
  due: boolean;
  stuck: boolean;
  lastError: string | null;
};

/**
 * When each loaded performer was last pulled from setlist.fm, and what is due.
 *
 * Derived from the import history rather than a column on the performer: the
 * `show_imports` rows already say what was attempted, when, and how it went,
 * and a second place to record it is a second place to get it wrong. A
 * performer loaded by the scripts has no rows at all, which reads as "never
 * refreshed" — correct, and the reason they're first in the queue.
 */
export async function refreshStates(): Promise<RefreshState[]> {
  const performers = await loadedPerformers();
  if (performers.length === 0) return [];

  const result = await db.execute(sql`
    SELECT
      performer,
      MAX(created_at)                                 AS last_attempt,
      MAX(finished_at) FILTER (WHERE status = 'done') AS last_success,
      MAX(mbid)        FILTER (WHERE status = 'done') AS mbid
    FROM show_imports
    GROUP BY performer
  `);

  const history = new Map(
    rowsOf<{
      performer: string;
      last_attempt: string | Date | null;
      last_success: string | Date | null;
      mbid: string | null;
    }>(result).map((r) => [r.performer.toLowerCase(), r]),
  );

  // Failures since the last success, counted per performer in one pass.
  const failResult = await db.execute(sql`
    SELECT i.performer, COUNT(*) AS n, MAX(i.error) AS last_error
    FROM show_imports i
    WHERE i.status = 'failed'
      AND i.created_at > COALESCE(
        (SELECT MAX(d.finished_at) FROM show_imports d
          WHERE d.performer = i.performer AND d.status = 'done'),
        '-infinity'::timestamptz
      )
    GROUP BY i.performer
  `);
  const failures = new Map(
    rowsOf<{ performer: string; n: string | number; last_error: string | null }>(
      failResult,
    ).map((r) => [
      r.performer.toLowerCase(),
      { n: Number(r.n), error: r.last_error },
    ]),
  );

  const everyMs = SHOW_REFRESH_DAYS * 86_400_000;
  const now = Date.now();

  return performers.map((performer) => {
    const key = performer.label.toLowerCase();
    const row = history.get(key);
    const fail = failures.get(key);

    const lastSuccess = row?.last_success ? new Date(row.last_success) : null;
    const lastAttempt = row?.last_attempt ? new Date(row.last_attempt) : null;
    const failCount = fail?.n ?? 0;

    const dueAt = lastSuccess ? new Date(lastSuccess.getTime() + everyMs) : null;
    const stuck = failCount >= GIVE_UP_AFTER;
    const cooling =
      lastAttempt !== null && now - lastAttempt.getTime() < RETRY_AFTER_MS;

    return {
      label: performer.label,
      mbid: row?.mbid ?? null,
      lastSuccess,
      lastAttempt,
      failures: failCount,
      dueAt,
      due:
        SHOW_REFRESH_DAYS > 0 &&
        !stuck &&
        !cooling &&
        (dueAt === null || dueAt.getTime() <= now),
      stuck,
      lastError: fail?.error ?? null,
    };
  });
}

/**
 * Start a refresh if one is due, and return what happened.
 *
 * Deliberately one performer per call rather than looping: imports run one at
 * a time anyway, and taking the single most-overdue artist each tick spreads
 * a catalogue across hours instead of queueing an afternoon of API calls the
 * moment the week rolls over.
 */
export async function refreshDuePerformer(): Promise<
  { started: string } | { skipped: string }
> {
  if (SHOW_REFRESH_DAYS <= 0) return { skipped: "auto-refresh is off" };
  if (!syncAvailable()) return { skipped: "no SETLISTFM_API_KEY" };

  const busy = await activeImport();
  if (busy) return { skipped: `${busy.performer} is already importing` };

  const states = await refreshStates();
  const due = states
    .filter((s) => s.due)
    // Never refreshed first, then whoever has waited longest.
    .sort(
      (a, b) =>
        (a.lastSuccess?.getTime() ?? 0) - (b.lastSuccess?.getTime() ?? 0),
    );

  const next = due[0];
  if (!next) return { skipped: "nothing due" };

  const result = await startArtistSync({
    name: next.label,
    // Reuse the id a previous run resolved, so a performer whose tag label
    // isn't exactly setlist.fm's spelling still refreshes, and one whose name
    // is shared by another band can't drift onto the wrong one.
    mbid: next.mbid ?? undefined,
    userId: null,
  });

  if (result.ok) return { started: next.label };
  if ("choices" in result) {
    // Ambiguous without an mbid, and a scheduler must not guess which band.
    await recordSchedulerFailure(
      next.label,
      `"${next.label}" matches ${result.choices.length} artists on setlist.fm — import it once by hand to pin which.`,
    );
    return { skipped: `${next.label} is ambiguous` };
  }
  await recordSchedulerFailure(next.label, result.error);
  return { skipped: `${next.label}: ${result.error}` };
}

/**
 * A refusal before a job row exists still has to be remembered, or the
 * scheduler retries it every tick and nothing ever shows up on the admin page
 * to explain why a performer stopped updating.
 */
async function recordSchedulerFailure(
  performer: string,
  error: string,
): Promise<void> {
  await db.insert(showImports).values({
    id: newId(),
    performer,
    status: "failed",
    error,
    finishedAt: new Date(),
  });
}

/** Shows with no uploads yet — the cold-start number worth watching. */
export async function showStats(): Promise<{
  shows: number;
  moments: number;
  venues: number;
}> {
  const result = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM shows) AS shows,
      (SELECT COUNT(*) FROM (SELECT DISTINCT where_tag_id, event_date FROM shows) z)
        AS moments,
      (SELECT COUNT(DISTINCT where_tag_id) FROM shows) AS venues
  `);
  const row = rowsOf<{
    shows: string | number;
    moments: string | number;
    venues: string | number;
  }>(result)[0];
  return {
    shows: Number(row?.shows ?? 0),
    moments: Number(row?.moments ?? 0),
    venues: Number(row?.venues ?? 0),
  };
}
