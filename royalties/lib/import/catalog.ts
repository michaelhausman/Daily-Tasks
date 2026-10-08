import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  workTitles,
  workWriters,
  works,
  writers,
  type Pro,
  PROS,
} from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { parseSheet, pickColumn } from "@/lib/csv";
import { slugify, titleKey } from "@/lib/text";

/**
 * Load a song catalogue: works, their writers, and the splits between them.
 *
 * Catalogue exports have no standard shape — a publisher's differs from a
 * PRO's repertory download differs from a spreadsheet somebody maintains by
 * hand — so columns are guessed from their headers and the guess is reported.
 * A wrong guess that is visible costs a minute; a wrong guess that is silent
 * misattributes a catalogue.
 *
 * One row per writer per work is the common export shape, so rows are folded
 * together by title: three rows for "Save Me" with three writers become one
 * work with three splits.
 */

const TITLE_COLUMNS = ["title", "work title", "song", "song title", "work", "composition"];
const WRITER_COLUMNS = ["writer", "writers", "composer", "author", "writer name", "interested party"];
const SHARE_COLUMNS = ["share", "split", "writer share", "percentage", "pct", "%", "ownership"];
const IPI_COLUMNS = ["ipi", "ipi number", "cae", "cae ipi", "ipi name number"];
const PRO_COLUMNS = ["pro", "society", "affiliation", "performing rights organization"];
const ISWC_COLUMNS = ["iswc"];
const PUBLISHER_COLUMNS = ["publisher", "publisher name", "original publisher"];
const ROLE_COLUMNS = ["role", "writer role", "capacity"];

export type CatalogMapping = {
  title: string | null;
  writer: string | null;
  share: string | null;
  ipi: string | null;
  pro: string | null;
  iswc: string | null;
  publisher: string | null;
  role: string | null;
};

export function guessCatalogColumns(headers: string[]): CatalogMapping {
  return {
    title: pickColumn(headers, TITLE_COLUMNS),
    writer: pickColumn(headers, WRITER_COLUMNS),
    share: pickColumn(headers, SHARE_COLUMNS),
    ipi: pickColumn(headers, IPI_COLUMNS),
    pro: pickColumn(headers, PRO_COLUMNS),
    iswc: pickColumn(headers, ISWC_COLUMNS),
    publisher: pickColumn(headers, PUBLISHER_COLUMNS),
    role: pickColumn(headers, ROLE_COLUMNS),
  };
}

/**
 * A share as basis points.
 *
 * Catalogues write shares as "50", "50%", "0.5" or "50.00". The ambiguous one
 * is a bare number below 1, which is a fraction everywhere except where it
 * means "0.5 percent" — rare enough, and a 0.5% writer share is implausible
 * enough, that reading it as a fraction is the safer default.
 */
export function parseShareBp(input: string): number | null {
  const text = input.trim().replace(/%/g, "");
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  const bp = value > 0 && value <= 1 ? Math.round(value * 10000) : Math.round(value * 100);
  return bp > 10000 ? null : bp;
}

function normalizePro(input: string): Pro | null {
  const text = input.trim().toUpperCase().replace(/[^A-Z]/g, "");
  const found = PROS.find((p) => p.toUpperCase() === text);
  return found ?? null;
}

export type CatalogResult = {
  mapping: CatalogMapping;
  worksAdded: number;
  worksUpdated: number;
  writersAdded: number;
  splitsWritten: number;
  /** Works whose writer shares don't total 100% — usually a missing row. */
  oddSplits: Array<{ title: string; totalBp: number }>;
  skipped: string[];
};

export async function importCatalog(
  csv: string,
  opts: { trackedWriters?: string[]; mapping?: Partial<CatalogMapping> } = {},
): Promise<CatalogResult> {
  const sheet = parseSheet(csv);
  const mapping = { ...guessCatalogColumns(sheet.headers), ...opts.mapping };

  if (!mapping.title) {
    throw new Error(
      `No title column found. Headers were: ${sheet.headers.join(", ") || "(none)"}`,
    );
  }

  const tracked = new Set((opts.trackedWriters ?? []).map((n) => slugify(n)));

  // Fold the export's one-row-per-writer shape into one entry per work.
  type Pending = {
    title: string;
    iswc?: string;
    publisher?: string;
    writers: Array<{ name: string; shareBp: number; ipi?: string; pro?: Pro; role?: string }>;
  };
  const byTitle = new Map<string, Pending>();
  const skipped: string[] = [];

  for (const row of sheet.rows) {
    const title = (row[mapping.title] ?? "").trim();
    if (!title) continue;

    const key = titleKey(title);
    if (!key) {
      skipped.push(`${title} (no usable title)`);
      continue;
    }

    const entry = byTitle.get(key) ?? { title, writers: [] };
    if (mapping.iswc && row[mapping.iswc]) entry.iswc = row[mapping.iswc].trim();
    if (mapping.publisher && row[mapping.publisher]) {
      entry.publisher = row[mapping.publisher].trim();
    }

    const writerName = mapping.writer ? (row[mapping.writer] ?? "").trim() : "";
    if (writerName) {
      const shareBp = mapping.share ? parseShareBp(row[mapping.share] ?? "") : null;
      entry.writers.push({
        name: writerName,
        shareBp: shareBp ?? 0,
        ipi: mapping.ipi ? row[mapping.ipi]?.trim() || undefined : undefined,
        pro: mapping.pro ? normalizePro(row[mapping.pro] ?? "") ?? undefined : undefined,
        role: mapping.role ? row[mapping.role]?.trim() || undefined : undefined,
      });
    }

    byTitle.set(key, entry);
  }

  let worksAdded = 0;
  let worksUpdated = 0;
  let writersAdded = 0;
  let splitsWritten = 0;
  const oddSplits: CatalogResult["oddSplits"] = [];

  for (const [key, entry] of byTitle) {
    // ── writers ──────────────────────────────────────────────────────────
    const writerIds = new Map<string, string>();
    for (const w of entry.writers) {
      const nameKey = slugify(w.name);
      if (!nameKey || writerIds.has(nameKey)) continue;

      const existing = await db
        .select()
        .from(writers)
        .where(eq(writers.nameKey, nameKey))
        .limit(1);

      if (existing[0]) {
        writerIds.set(nameKey, existing[0].id);
        // Fill in details the first import didn't have, without overwriting.
        const patch: Partial<typeof writers.$inferInsert> = {};
        if (w.ipi && !existing[0].ipi) patch.ipi = w.ipi;
        if (w.pro && !existing[0].pro) patch.pro = w.pro;
        if (tracked.has(nameKey) && !existing[0].tracked) patch.tracked = true;
        if (Object.keys(patch).length > 0) {
          await db.update(writers).set(patch).where(eq(writers.id, existing[0].id));
        }
      } else {
        const id = newId();
        await db.insert(writers).values({
          id,
          name: w.name,
          nameKey,
          ipi: w.ipi ?? null,
          pro: w.pro ?? null,
          tracked: tracked.has(nameKey),
        });
        writerIds.set(nameKey, id);
        writersAdded++;
      }
    }

    // ── the work ─────────────────────────────────────────────────────────
    const existingWork = await db
      .select()
      .from(works)
      .where(eq(works.titleKey, key))
      .limit(1);

    let workId: string;
    if (existingWork[0]) {
      workId = existingWork[0].id;
      await db
        .update(works)
        .set({
          iswc: entry.iswc ?? existingWork[0].iswc,
          publisher: entry.publisher ?? existingWork[0].publisher,
        })
        .where(eq(works.id, workId));
      worksUpdated++;
    } else {
      workId = newId();
      await db.insert(works).values({
        id: workId,
        title: entry.title,
        titleKey: key,
        iswc: entry.iswc ?? null,
        publisher: entry.publisher ?? null,
      });
      worksAdded++;
    }

    // ── splits ───────────────────────────────────────────────────────────
    // Replaced rather than merged: a re-import is the catalogue's current
    // truth, and leaving a stale writer attached would overstate the share.
    if (entry.writers.length > 0) {
      await db.delete(workWriters).where(eq(workWriters.workId, workId));
      for (const w of entry.writers) {
        const writerId = writerIds.get(slugify(w.name));
        if (!writerId) continue;
        await db
          .insert(workWriters)
          .values({ workId, writerId, shareBp: w.shareBp, role: w.role ?? null })
          .onConflictDoUpdate({
            target: [workWriters.workId, workWriters.writerId],
            set: { shareBp: w.shareBp, role: w.role ?? null },
          });
        splitsWritten++;
      }

      const totalBp = entry.writers.reduce((sum, w) => sum + w.shareBp, 0);
      if (totalBp !== 10000 && totalBp !== 0) {
        oddSplits.push({ title: entry.title, totalBp });
      }
    }
  }

  await recomputeOurShares();

  return {
    mapping,
    worksAdded,
    worksUpdated,
    writersAdded,
    splitsWritten,
    oddSplits,
    skipped,
  };
}

/**
 * Recalculate how much of each work belongs to the tracked writers.
 *
 * Stored rather than derived at read time because every report filters on it,
 * and recomputing is cheap and happens only when the catalogue changes.
 */
export async function recomputeOurShares(): Promise<void> {
  await db.execute(sql`
    UPDATE works SET our_share_bp = COALESCE((
      SELECT SUM(ww.share_bp)
      FROM work_writers ww
        INNER JOIN writers w ON w.id = ww.writer_id
      WHERE ww.work_id = works.id AND w.tracked = true
    ), 0)
  `);
}

/** Mark writers as ours. Everything downstream keys off this. */
export async function trackWriters(names: string[]): Promise<number> {
  const keys = names.map((n) => slugify(n)).filter(Boolean);
  if (keys.length === 0) return 0;

  const rows = await db
    .update(writers)
    .set({ tracked: true })
    .where(inArray(writers.nameKey, keys))
    .returning();

  await recomputeOurShares();
  return rows.length;
}

/** Record that two titles are the same song, so future imports match it. */
export async function addWorkAlias(
  workId: string,
  title: string,
  note?: string,
): Promise<boolean> {
  const key = titleKey(title);
  if (!key) return false;

  const clash = await db
    .select({ id: works.id })
    .from(works)
    .where(eq(works.titleKey, key))
    .limit(1);
  if (clash[0]) return false;

  await db
    .insert(workTitles)
    .values({ id: newId(), workId, title, titleKey: key, note: note ?? null })
    .onConflictDoNothing();
  return true;
}

/** Resolve a title from a setlist or a statement to a work. */
export async function matchTitle(title: string): Promise<string | null> {
  const key = titleKey(title);
  if (!key) return null;

  const direct = await db
    .select({ id: works.id })
    .from(works)
    .where(eq(works.titleKey, key))
    .limit(1);
  if (direct[0]) return direct[0].id;

  const alias = await db
    .select({ workId: workTitles.workId })
    .from(workTitles)
    .where(eq(workTitles.titleKey, key))
    .limit(1);
  return alias[0]?.workId ?? null;
}

/**
 * Attach every unmatched performance and statement line to a work, now that
 * the catalogue knows more than it did when they were imported.
 */
export async function relinkTitles(): Promise<{
  performances: number;
  statementLines: number;
}> {
  const linked = await db.execute(sql`
    WITH lookup AS (
      SELECT title_key, id AS work_id FROM works
      UNION ALL
      SELECT title_key, work_id FROM work_titles
    )
    UPDATE performances p
    SET work_id = lookup.work_id
    FROM lookup
    WHERE p.work_id IS NULL AND p.title_key = lookup.title_key
  `);

  const lines = await db.execute(sql`
    WITH lookup AS (
      SELECT title_key, id AS work_id FROM works
      UNION ALL
      SELECT title_key, work_id FROM work_titles
    )
    UPDATE statement_lines sl
    SET work_id = lookup.work_id
    FROM lookup
    WHERE sl.work_id IS NULL AND sl.title_key = lookup.title_key
  `);

  const count = (result: unknown): number => {
    const r = result as { rowCount?: number; affectedRows?: number };
    return r?.rowCount ?? r?.affectedRows ?? 0;
  };
  return { performances: count(linked), statementLines: count(lines) };
}

/** Works with no tracked writer, for the "is this ours?" review. */
export async function unmatchedTitles(limit = 200): Promise<
  Array<{ titleKey: string; title: string; performances: number }>
> {
  const result = await db.execute(sql`
    SELECT
      p.title_key,
      MIN(p.raw_title) AS title,
      COUNT(*)         AS performances
    FROM performances p
    WHERE p.work_id IS NULL AND p.not_ours_at IS NULL
    GROUP BY p.title_key
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `);

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);

  return (rows as Array<{ title_key: string; title: string; performances: string | number }>).map(
    (r) => ({
      titleKey: r.title_key,
      title: r.title,
      performances: Number(r.performances),
    }),
  );
}
