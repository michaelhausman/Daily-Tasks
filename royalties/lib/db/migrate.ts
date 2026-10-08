import { sql } from "drizzle-orm";

import { db } from "./index";

/**
 * Hand-written idempotent DDL, applied at every boot. Small, stable schema;
 * every statement is guarded, so running it repeatedly is safe.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS writers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    ipi TEXT,
    pro TEXT,
    tracked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS writers_name_key_unique ON writers (name_key)`,
  `CREATE INDEX IF NOT EXISTS writers_tracked_idx ON writers (tracked)`,

  `CREATE TABLE IF NOT EXISTS works (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    iswc TEXT,
    publisher TEXT,
    our_share_bp INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS works_title_key_unique ON works (title_key)`,
  `CREATE INDEX IF NOT EXISTS works_iswc_idx ON works (iswc)`,

  `CREATE TABLE IF NOT EXISTS work_titles (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS work_titles_key_unique ON work_titles (title_key)`,
  `CREATE INDEX IF NOT EXISTS work_titles_work_idx ON work_titles (work_id)`,

  `CREATE TABLE IF NOT EXISTS work_writers (
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    writer_id TEXT NOT NULL REFERENCES writers(id) ON DELETE CASCADE,
    share_bp INTEGER NOT NULL DEFAULT 0,
    role TEXT,
    PRIMARY KEY (work_id, writer_id)
  )`,
  `CREATE INDEX IF NOT EXISTS work_writers_writer_idx ON work_writers (writer_id)`,

  `CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    mbid TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS artists_name_key_unique ON artists (name_key)`,

  `CREATE TABLE IF NOT EXISTS shows (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    event_date DATE NOT NULL,
    venue TEXT,
    venue_key TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    tour TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    setlist_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS shows_artist_place_date_unique
     ON shows (artist_id, venue_key, event_date)`,
  `CREATE INDEX IF NOT EXISTS shows_date_idx ON shows (event_date)`,

  `CREATE TABLE IF NOT EXISTS performances (
    id TEXT PRIMARY KEY,
    show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
    raw_title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    not_ours_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS performances_show_pos_unique
     ON performances (show_id, position)`,
  `CREATE INDEX IF NOT EXISTS performances_work_idx ON performances (work_id)`,
  `CREATE INDEX IF NOT EXISTS performances_title_idx ON performances (title_key)`,

  `CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    show_id TEXT NOT NULL UNIQUE REFERENCES shows(id) ON DELETE CASCADE,
    gross_cents INTEGER,
    pro_fee_cents INTEGER,
    licensed_by TEXT,
    note TEXT,
    source_file TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS contracts_show_idx ON contracts (show_id)`,

  `CREATE TABLE IF NOT EXISTS statements (
    id TEXT PRIMARY KEY,
    pro TEXT NOT NULL,
    filename TEXT NOT NULL,
    period_start DATE,
    period_end DATE,
    note TEXT,
    line_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS statements_period_idx ON statements (period_start, period_end)`,

  `CREATE TABLE IF NOT EXISTS statement_lines (
    id TEXT PRIMARY KEY,
    statement_id TEXT NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
    raw_title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    performed_on DATE,
    venue TEXT,
    venue_key TEXT,
    performance_count INTEGER,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    raw TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS statement_lines_statement_idx ON statement_lines (statement_id)`,
  `CREATE INDEX IF NOT EXISTS statement_lines_work_idx ON statement_lines (work_id)`,
  `CREATE INDEX IF NOT EXISTS statement_lines_title_idx ON statement_lines (title_key)`,
  `CREATE INDEX IF NOT EXISTS statement_lines_performed_idx ON statement_lines (performed_on)`,
];

const CONSTRAINTS: Array<[table: string, name: string, check: string]> = [
  ["writers", "writers_pro_check", `pro IS NULL OR pro IN ('ASCAP','BMI','SESAC','GMR','PRS','SOCAN','other')`],
  ["statements", "statements_pro_check", `pro IN ('ASCAP','BMI','SESAC','GMR','PRS','SOCAN','other')`],
  ["shows", "shows_source_check", `source IN ('setlistfm','manual','import')`],
  // Shares are basis points: 0–100%. A catalogue row claiming 150% is a
  // parsing error, and silently storing it would overstate every total.
  ["work_writers", "work_writers_share_check", `share_bp >= 0 AND share_bp <= 10000`],
  ["works", "works_share_check", `our_share_bp >= 0 AND our_share_bp <= 10000`],
];

export async function runMigrations() {
  for (const statement of STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
  for (const [table, name, check] of CONSTRAINTS) {
    await db.execute(
      sql.raw(`DO $$ BEGIN
        ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check});
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`),
    );
  }
}
