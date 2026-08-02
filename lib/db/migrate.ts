import { sql } from "drizzle-orm";

import { db } from "./index";

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
}
