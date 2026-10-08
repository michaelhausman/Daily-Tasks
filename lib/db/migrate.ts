import { eq, isNull, sql } from "drizzle-orm";

import { matchKey, slugify } from "@/lib/tags/normalize";
import { db } from "./index";
import { shows, tags } from "./schema";

/**
 * Schema is small and stable enough that hand-written idempotent DDL beats
 * wiring up drizzle-kit codegen and a migration folder. Every statement is
 * guarded, so running this repeatedly — including on every boot — is safe.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_handle_unique ON users (handle)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,

  `CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    original_name TEXT,
    thumb_key TEXT,
    web_key TEXT,
    poster_key TEXT,
    waveform_json TEXT,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    caption TEXT,
    event_date DATE,
    captured_at TIMESTAMPTZ,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    visibility TEXT NOT NULL DEFAULT 'public',
    status TEXT NOT NULL DEFAULT 'processing',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS media_event_date_idx ON media (event_date)`,
  `CREATE INDEX IF NOT EXISTS media_owner_idx ON media (owner_id)`,
  `CREATE INDEX IF NOT EXISTS media_created_idx ON media (created_at)`,
  `CREATE INDEX IF NOT EXISTS media_feed_idx ON media (visibility, status, created_at)`,

  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    facet TEXT NOT NULL,
    slug TEXT NOT NULL,
    label TEXT NOT NULL,
    canonical_tag_id TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tags_facet_slug_unique ON tags (facet, slug)`,
  `CREATE INDEX IF NOT EXISTS tags_usage_idx ON tags (facet, usage_count)`,

  `CREATE TABLE IF NOT EXISTS media_tags (
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (media_id, tag_id)
  )`,
  `CREATE INDEX IF NOT EXISTS media_tags_tag_idx ON media_tags (tag_id)`,

  `CREATE TABLE IF NOT EXISTS likes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, media_id)
  )`,
  `CREATE INDEX IF NOT EXISTS likes_media_idx ON likes (media_id)`,

  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    media_id TEXT REFERENCES media(id) ON DELETE CASCADE,
    moment_where TEXT,
    moment_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS comments_media_idx ON comments (media_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS comments_moment_idx ON comments (moment_where, moment_date, created_at)`,

  `CREATE TABLE IF NOT EXISTS tag_follows (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tag_id)
  )`,
  `CREATE INDEX IF NOT EXISTS tag_follows_tag_idx ON tag_follows (tag_id)`,

  `CREATE TABLE IF NOT EXISTS moment_follows (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    where_slug TEXT NOT NULL,
    event_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, where_slug, event_date)
  )`,
  `CREATE INDEX IF NOT EXISTS moment_follows_key_idx ON moment_follows (where_slug, event_date)`,

  // Moderation columns are added rather than baked into CREATE TABLE so an
  // existing deployment picks them up on the next boot.
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT`,
  `ALTER TABLE media ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ`,
  `ALTER TABLE media ADD COLUMN IF NOT EXISTS hidden_by TEXT`,
  `ALTER TABLE media ADD COLUMN IF NOT EXISTS hidden_reason TEXT`,
  // Every public listing filters on this, so it wants an index.
  `CREATE INDEX IF NOT EXISTS media_hidden_idx ON media (hidden_at)`,

  `CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    media_id TEXT REFERENCES media(id) ON DELETE CASCADE,
    comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
    moment_where TEXT,
    moment_date DATE,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS reports_media_idx ON reports (media_id)`,

  `CREATE TABLE IF NOT EXISTS shows (
    id TEXT PRIMARY KEY,
    who_tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    where_tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    event_date DATE NOT NULL,
    city TEXT,
    region TEXT,
    tour TEXT,
    setlist_json TEXT,
    setlist_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS shows_who_where_date_unique ON shows (who_tag_id, where_tag_id, event_date)`,
  `CREATE INDEX IF NOT EXISTS shows_where_date_idx ON shows (where_tag_id, event_date)`,
  // Aligning an incoming touring history scans shows by date, across performers.
  `CREATE INDEX IF NOT EXISTS shows_event_date_idx ON shows (event_date)`,

  `CREATE TABLE IF NOT EXISTS show_imports (
    id TEXT PRIMARY KEY,
    performer TEXT NOT NULL,
    mbid TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    page INTEGER NOT NULL DEFAULT 0,
    pages INTEGER NOT NULL DEFAULT 0,
    fetched INTEGER NOT NULL DEFAULT 0,
    added INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    aligned INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS show_imports_created_idx ON show_imports (created_at)`,

  // Identity for the tour a show belongs to, so a tour has a page.
  `ALTER TABLE shows ADD COLUMN IF NOT EXISTS tour_slug TEXT`,
  `CREATE INDEX IF NOT EXISTS shows_tour_idx ON shows (tour_slug)`,

  // Looser-than-slug key for "did you mean", and the review mark for places
  // somebody invented. Added rather than baked in, for existing deployments.
  `ALTER TABLE tags ADD COLUMN IF NOT EXISTS match_key TEXT`,
  `ALTER TABLE tags ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS tags_match_idx ON tags (facet, match_key)`,

  `CREATE TABLE IF NOT EXISTS venue_decisions (
    id TEXT PRIMARY KEY,
    city TEXT NOT NULL,
    names_json TEXT NOT NULL,
    event_date DATE,
    different BOOLEAN NOT NULL DEFAULT false,
    note TEXT,
    decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS venue_decisions_city_idx ON venue_decisions (city)`,
];

/**
 * The enum-like columns are plain TEXT (see schema.ts for why), so integrity
 * comes from CHECK constraints. Postgres has no `ADD CONSTRAINT IF NOT EXISTS`,
 * so each is wrapped in a DO block that swallows the duplicate-object error.
 */
const CONSTRAINTS: Array<[table: string, name: string, check: string]> = [
  ["media", "media_kind_check", `kind IN ('photo','video','audio')`],
  ["media", "media_visibility_check", `visibility IN ('public','unlisted')`],
  ["media", "media_status_check", `status IN ('processing','ready','failed')`],
  ["tags", "tags_facet_check", `facet IN ('who','where','topic')`],
  // A comment belongs to exactly one thing: an upload, or a moment.
  [
    "comments",
    "comments_one_target_check",
    `(media_id IS NOT NULL AND moment_where IS NULL AND moment_date IS NULL)
     OR (media_id IS NULL AND moment_where IS NOT NULL AND moment_date IS NOT NULL)`,
  ],
  ["comments", "comments_body_check", `length(btrim(body)) > 0`],
  [
    "reports",
    "reports_reason_check",
    `reason IN ('copyright','abuse','sexual','spam','wrong-tags','other')`,
  ],
  [
    "reports",
    "reports_status_check",
    `status IN ('open','actioned','dismissed')`,
  ],
  [
    "show_imports",
    "show_imports_status_check",
    `status IN ('queued','fetching','importing','done','failed')`,
  ],
  // Exactly one target, same shape as the comments constraint.
  [
    "reports",
    "reports_one_target_check",
    `(media_id IS NOT NULL)::int
     + (comment_id IS NOT NULL)::int
     + (moment_where IS NOT NULL AND moment_date IS NOT NULL)::int = 1`,
  ],
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

  // Self-referential FK is added after the table exists so the two orderings
  // (fresh create vs. existing database) both work.
  await db.execute(
    sql.raw(`DO $$ BEGIN
      ALTER TABLE tags ADD CONSTRAINT tags_canonical_fk
        FOREIGN KEY (canonical_tag_id) REFERENCES tags(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;`),
  );

  await backfillMatchKeys();
  await backfillTourSlugs();
}

/**
 * Give shows imported before tours had pages their tour's identity.
 *
 * Same shape as the match-key backfill, and for the same reason: slugify
 * lives in TypeScript. Shows with no tour never match, so this costs one
 * empty query per boot once it has run.
 */
async function backfillTourSlugs(): Promise<void> {
  for (;;) {
    const pending = await db
      .select({ id: shows.id, tour: shows.tour })
      .from(shows)
      .where(sql`${shows.tour} IS NOT NULL AND ${shows.tourSlug} IS NULL`)
      .limit(500);

    if (pending.length === 0) return;

    for (const show of pending) {
      await db
        .update(shows)
        .set({ tourSlug: slugify(show.tour ?? "") })
        .where(eq(shows.id, show.id));
    }
  }
}

/**
 * Fill in `tags.match_key` for rows that predate the column.
 *
 * The one piece of data migration here rather than DDL, because the key folds
 * theatre/theater and strips articles — rules that live in TypeScript and have
 * no SQL equivalent worth maintaining twice. Runs at every boot, but only
 * touches rows where the column is still null, so it does nothing after the
 * first time.
 */
async function backfillMatchKeys(): Promise<void> {
  for (;;) {
    const pending = await db
      .select({ id: tags.id, label: tags.label })
      .from(tags)
      .where(isNull(tags.matchKey))
      .limit(500);

    if (pending.length === 0) return;

    for (const tag of pending) {
      await db
        .update(tags)
        // Empty string, not null, for a label with nothing left after folding
        // — otherwise it would be picked up again on every boot forever.
        .set({ matchKey: matchKey(tag.label) })
        .where(eq(tags.id, tag.id));
    }
  }
}
