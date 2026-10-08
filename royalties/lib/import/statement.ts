import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  statementLines,
  statements,
  type Pro,
} from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { parseSheet, pickColumn } from "@/lib/csv";
import { parseDate, parseMoneyCents, titleKey, venueKey } from "@/lib/text";
import { matchTitle } from "./catalog";

/**
 * Load a royalty statement.
 *
 * The decisive column is the performance date. A statement that itemises
 * individual performances — which is what ASCAP OnStage and BMI Live produce —
 * can be tied to a specific night, and absence of a line is then real evidence
 * that the night went unpaid. A statement that only gives a distribution
 * period is much weaker: it says a work earned something in a quarter, not
 * that any particular show was claimed.
 *
 * Both are imported, and the difference is carried through to the report
 * rather than smoothed over, because treating the second as the first would
 * quietly mark unclaimed performances as paid.
 */

const TITLE_COLUMNS = ["work title", "title", "song title", "composition", "work"];
const DATE_COLUMNS = ["performance date", "date of performance", "perf date", "date", "show date"];
const VENUE_COLUMNS = ["venue", "venue name", "location", "place of performance", "licensee"];
const AMOUNT_COLUMNS = ["amount", "royalty", "earnings", "total", "writer amount", "dollars", "royalty amount", "net"];
const COUNT_COLUMNS = ["performances", "number of performances", "perf count", "plays", "uses"];
const PERIOD_COLUMNS = ["distribution period", "period", "quarter", "statement period"];

export type StatementMapping = {
  title: string | null;
  date: string | null;
  venue: string | null;
  amount: string | null;
  count: string | null;
  period: string | null;
};

export function guessStatementColumns(headers: string[]): StatementMapping {
  return {
    title: pickColumn(headers, TITLE_COLUMNS),
    date: pickColumn(headers, DATE_COLUMNS),
    venue: pickColumn(headers, VENUE_COLUMNS),
    amount: pickColumn(headers, AMOUNT_COLUMNS),
    count: pickColumn(headers, COUNT_COLUMNS),
    period: pickColumn(headers, PERIOD_COLUMNS),
  };
}

export type StatementResult = {
  statementId: string;
  mapping: StatementMapping;
  lines: number;
  itemised: number;
  matchedToWorks: number;
  totalCents: number;
  periodStart: string | null;
  periodEnd: string | null;
  unmatchedTitles: string[];
};

export async function importStatement(
  csv: string,
  opts: {
    pro: Pro;
    filename: string;
    periodStart?: string;
    periodEnd?: string;
    note?: string;
    mapping?: Partial<StatementMapping>;
  },
): Promise<StatementResult> {
  const sheet = parseSheet(csv);
  const mapping = { ...guessStatementColumns(sheet.headers), ...opts.mapping };

  if (!mapping.title) {
    throw new Error(
      `No work-title column found. Headers were: ${sheet.headers.join(", ") || "(none)"}`,
    );
  }

  const statementId = newId();
  const rows: Array<typeof statementLines.$inferInsert> = [];
  const dates: string[] = [];
  const unmatched = new Set<string>();
  let itemised = 0;
  let matchedToWorks = 0;
  let totalCents = 0;

  for (const row of sheet.rows) {
    const rawTitle = (row[mapping.title] ?? "").trim();
    if (!rawTitle) continue;

    const key = titleKey(rawTitle);
    if (!key) continue;

    const performedOn = mapping.date ? parseDate(row[mapping.date] ?? "") : null;
    if (performedOn) {
      itemised++;
      dates.push(performedOn);
    }

    const workId = await matchTitle(rawTitle);
    if (workId) matchedToWorks++;
    else unmatched.add(rawTitle);

    const amountCents = mapping.amount
      ? (parseMoneyCents(row[mapping.amount] ?? "") ?? 0)
      : 0;
    totalCents += amountCents;

    const venue = mapping.venue ? (row[mapping.venue] ?? "").trim() : "";
    const countText = mapping.count ? (row[mapping.count] ?? "").trim() : "";
    const count = countText ? Number(countText.replace(/[^0-9]/g, "")) : null;

    rows.push({
      id: newId(),
      statementId,
      workId,
      rawTitle,
      titleKey: key,
      performedOn,
      venue: venue || null,
      venueKey: venue ? venueKey(venue) : null,
      performanceCount: Number.isFinite(count) ? count : null,
      amountCents,
      // The original row, so a disputed match can be traced to the file.
      raw: JSON.stringify(row),
    });
  }

  // When the file itemises performances, its own dates bound the period more
  // accurately than anything typed in by hand.
  dates.sort();
  const periodStart = opts.periodStart ?? dates[0] ?? null;
  const periodEnd = opts.periodEnd ?? dates[dates.length - 1] ?? null;

  await db.insert(statements).values({
    id: statementId,
    pro: opts.pro,
    filename: opts.filename,
    periodStart,
    periodEnd,
    note: opts.note ?? null,
    lineCount: rows.length,
  });

  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(statementLines).values(rows.slice(i, i + 500));
  }

  return {
    statementId,
    mapping,
    lines: rows.length,
    itemised,
    matchedToWorks,
    totalCents,
    periodStart,
    periodEnd,
    unmatchedTitles: [...unmatched].slice(0, 50),
  };
}

export async function deleteStatement(id: string): Promise<void> {
  await db.delete(statements).where(eq(statements.id, id));
}

export async function listStatements() {
  return db
    .select({
      id: statements.id,
      pro: statements.pro,
      filename: statements.filename,
      periodStart: statements.periodStart,
      periodEnd: statements.periodEnd,
      lineCount: statements.lineCount,
      createdAt: statements.createdAt,
      itemised: sql<string>`(
        SELECT COUNT(*) FROM statement_lines sl
        WHERE sl.statement_id = ${statements.id} AND sl.performed_on IS NOT NULL
      )`,
      totalCents: sql<string>`COALESCE((
        SELECT SUM(sl.amount_cents) FROM statement_lines sl
        WHERE sl.statement_id = ${statements.id}
      ), 0)`,
    })
    .from(statements)
    .orderBy(sql`${statements.periodStart} DESC NULLS LAST`);
}
