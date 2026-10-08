import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * Which performances were never claimed.
 *
 * The question is deliberately not "did the contract money arrive". A
 * promoter's licence fee goes into a PRO's pool and is distributed across
 * everything that pool covers; it was never earmarked for these writers, so
 * subtracting receipts from it would produce a shortfall that doesn't exist.
 *
 * What *is* real: a live performance of your work earns you money only if the
 * PRO is told it happened, through ASCAP OnStage or BMI Live, within their
 * window. A performance with no corresponding statement line was most likely
 * never submitted — and if it is still inside the window, it can be.
 *
 * Evidence comes in two strengths, kept apart on purpose:
 *
 *   **paid**     a statement itemises that work on that exact date. Proof.
 *   **inPeriod** a statement covering that date pays that work, but doesn't
 *                itemise. Suggestive, not proof — the earnings may be from
 *                radio, streaming, or a different night entirely.
 *   **none**     no statement mentions the work anywhere near the date.
 *
 * Collapsing inPeriod into paid would be the easy mistake, and it would hide
 * precisely the performances worth chasing.
 */

export type Coverage = "paid" | "inPeriod" | "none";

export type UnclaimedRow = {
  performanceId: string;
  showId: string;
  eventDate: string;
  artist: string;
  venue: string | null;
  city: string | null;
  workId: string;
  title: string;
  ourShareBp: number;
  coverage: Coverage;
  /** Cents on statement lines itemising this exact work and date. */
  paidCents: number;
  claimable: boolean;
  daysLeft: number | null;
};

export type UnclaimedSummary = {
  windowDays: number;
  totals: {
    performances: number;
    ourPerformances: number;
    paid: number;
    inPeriod: number;
    none: number;
    claimableNow: number;
    unmatchedTitles: number;
  };
  byWork: Array<{
    workId: string;
    title: string;
    performances: number;
    unclaimed: number;
    claimableNow: number;
    paidCents: number;
  }>;
  byYear: Array<{ year: string; performances: number; unclaimed: number }>;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

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

/**
 * The claim window, in days.
 *
 * Both ASCAP OnStage and BMI Live require submission within a limited period
 * after the performance, and both have changed their rules before. Rather
 * than bake in a number that quietly goes stale and misreports what is still
 * recoverable, it is configurable and surfaced in the UI as an assumption to
 * confirm. Six months is the common case.
 */
export const CLAIM_WINDOW_DAYS = Number(
  process.env.CLAIM_WINDOW_DAYS ?? 180,
);

function daysBetween(from: string, to: Date): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  return Math.floor((to.getTime() - start) / 86_400_000);
}

/**
 * Every performance of a tracked work, with what the statements say about it.
 *
 * One query rather than a loop: ten thousand performances against tens of
 * thousands of statement lines is a join, and doing it per row would take
 * minutes and produce the same answer.
 */
export async function unclaimedPerformances(
  opts: { windowDays?: number; coverage?: Coverage[]; limit?: number } = {},
): Promise<UnclaimedRow[]> {
  const windowDays = opts.windowDays ?? CLAIM_WINDOW_DAYS;
  const limit = opts.limit ?? 5000;

  const result = await db.execute(sql`
    SELECT
      p.id          AS performance_id,
      s.id          AS show_id,
      s.event_date,
      a.name        AS artist,
      s.venue,
      s.city,
      w.id          AS work_id,
      w.title,
      w.our_share_bp,
      COALESCE((
        SELECT SUM(sl.amount_cents) FROM statement_lines sl
        WHERE sl.work_id = w.id AND sl.performed_on = s.event_date
      ), 0) AS paid_cents,
      EXISTS (
        SELECT 1 FROM statement_lines sl
        WHERE sl.work_id = w.id AND sl.performed_on = s.event_date
      ) AS itemised,
      EXISTS (
        SELECT 1 FROM statement_lines sl
          INNER JOIN statements st ON st.id = sl.statement_id
        WHERE sl.work_id = w.id
          AND sl.performed_on IS NULL
          AND st.period_start IS NOT NULL AND st.period_end IS NOT NULL
          AND s.event_date BETWEEN st.period_start AND st.period_end
      ) AS in_period
    FROM performances p
      INNER JOIN shows s   ON s.id = p.show_id
      INNER JOIN artists a ON a.id = s.artist_id
      INNER JOIN works w   ON w.id = p.work_id
    WHERE w.our_share_bp > 0
    ORDER BY s.event_date DESC, p.position
    LIMIT ${limit}
  `);

  const now = new Date();

  return rowsOf<{
    performance_id: string;
    show_id: string;
    event_date: string | Date;
    artist: string;
    venue: string | null;
    city: string | null;
    work_id: string;
    title: string;
    our_share_bp: number;
    paid_cents: string | number;
    itemised: boolean;
    in_period: boolean;
  }>(result)
    .map((r) => {
      const eventDate = asDateString(r.event_date);
      const coverage: Coverage = r.itemised
        ? "paid"
        : r.in_period
          ? "inPeriod"
          : "none";

      const age = daysBetween(eventDate, now);
      const daysLeft = windowDays - age;

      return {
        performanceId: r.performance_id,
        showId: r.show_id,
        eventDate,
        artist: r.artist,
        venue: r.venue,
        city: r.city,
        workId: r.work_id,
        title: r.title,
        ourShareBp: r.our_share_bp,
        coverage,
        paidCents: Number(r.paid_cents),
        // Only worth chasing if it isn't already itemised as paid.
        claimable: coverage !== "paid" && daysLeft > 0 && age >= 0,
        daysLeft: daysLeft > 0 ? daysLeft : null,
      };
    })
    .filter((row) => !opts.coverage || opts.coverage.includes(row.coverage));
}

export async function unclaimedSummary(
  opts: { windowDays?: number } = {},
): Promise<UnclaimedSummary> {
  const windowDays = opts.windowDays ?? CLAIM_WINDOW_DAYS;
  const rows = await unclaimedPerformances({ windowDays });

  const totalResult = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM performances) AS performances,
      (SELECT COUNT(*) FROM performances WHERE work_id IS NULL AND not_ours_at IS NULL)
        AS unmatched
  `);
  const totals = rowsOf<{
    performances: string | number;
    unmatched: string | number;
  }>(totalResult)[0];

  const byWork = new Map<string, UnclaimedSummary["byWork"][number]>();
  const byYear = new Map<string, { performances: number; unclaimed: number }>();

  for (const row of rows) {
    const work =
      byWork.get(row.workId) ??
      {
        workId: row.workId,
        title: row.title,
        performances: 0,
        unclaimed: 0,
        claimableNow: 0,
        paidCents: 0,
      };
    work.performances++;
    if (row.coverage !== "paid") work.unclaimed++;
    if (row.claimable) work.claimableNow++;
    work.paidCents += row.paidCents;
    byWork.set(row.workId, work);

    const year = row.eventDate.slice(0, 4);
    const y = byYear.get(year) ?? { performances: 0, unclaimed: 0 };
    y.performances++;
    if (row.coverage !== "paid") y.unclaimed++;
    byYear.set(year, y);
  }

  return {
    windowDays,
    totals: {
      performances: Number(totals?.performances ?? 0),
      ourPerformances: rows.length,
      paid: rows.filter((r) => r.coverage === "paid").length,
      inPeriod: rows.filter((r) => r.coverage === "inPeriod").length,
      none: rows.filter((r) => r.coverage === "none").length,
      claimableNow: rows.filter((r) => r.claimable).length,
      unmatchedTitles: Number(totals?.unmatched ?? 0),
    },
    byWork: [...byWork.values()].sort((a, b) => b.unclaimed - a.unclaimed),
    byYear: [...byYear.entries()]
      .map(([year, v]) => ({ year, ...v }))
      .sort((a, b) => b.year.localeCompare(a.year)),
  };
}

/**
 * Shows with performances still inside the window — the actual worklist.
 *
 * Grouped by show because that is how a claim is filed: ASCAP OnStage and BMI
 * Live take a setlist for a date and a venue, not one song at a time.
 */
export async function claimableShows(
  opts: { windowDays?: number } = {},
): Promise<
  Array<{
    showId: string;
    eventDate: string;
    artist: string;
    venue: string | null;
    city: string | null;
    titles: string[];
    daysLeft: number;
  }>
> {
  const rows = await unclaimedPerformances(opts);
  const byShow = new Map<
    string,
    {
      showId: string;
      eventDate: string;
      artist: string;
      venue: string | null;
      city: string | null;
      titles: string[];
      daysLeft: number;
    }
  >();

  for (const row of rows) {
    if (!row.claimable || row.daysLeft === null) continue;
    const show =
      byShow.get(row.showId) ??
      {
        showId: row.showId,
        eventDate: row.eventDate,
        artist: row.artist,
        venue: row.venue,
        city: row.city,
        titles: [],
        daysLeft: row.daysLeft,
      };
    show.titles.push(row.title);
    byShow.set(row.showId, show);
  }

  // Soonest deadline first: this is a list to work down before dates expire.
  return [...byShow.values()].sort((a, b) => a.daysLeft - b.daysLeft);
}
