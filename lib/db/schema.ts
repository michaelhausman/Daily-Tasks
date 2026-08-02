import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Facets are what make grouping work. A freeform tag cloud fragments the moment
 * an uploader types "aimee mann" instead of "Aimee Mann"; typing each tag as a
 * WHO / WHERE / TOPIC lets us normalize and dedupe within a namespace.
 *
 * WHEN is deliberately absent here — see `media.eventDate`.
 */
export const FACETS = ["who", "where", "topic"] as const;
export type Facet = (typeof FACETS)[number];

export const MEDIA_KINDS = ["photo", "video", "audio"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const VISIBILITIES = ["public", "unlisted"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MEDIA_STATUSES = ["processing", "ready", "failed"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    avatarKey: text("avatar_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("users_handle_unique").on(t.handle),
    uniqueIndex("users_email_unique").on(t.email),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MEDIA_KINDS }).notNull(),

    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    originalName: text("original_name"),

    // Derivatives. Null when the source tooling was unavailable (e.g. no ffmpeg)
    // — the UI degrades to a generic placeholder rather than breaking.
    thumbKey: text("thumb_key"),
    webKey: text("web_key"),
    posterKey: text("poster_key"),
    waveformJson: text("waveform_json"),

    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),

    caption: text("caption"),

    /**
     * The WHEN facet, stored as a real ISO `YYYY-MM-DD` date rather than a tag row.
     *
     * This is the single most important modelling decision in the schema. As a
     * tag, "July 24th" / "7/24" / "24 July 2026" / "2026-07-24" are four distinct
     * rows and the pool silently splits four ways. As a column it is one value,
     * it sorts, and it supports range queries ("that whole festival weekend")
     * that a tag never could. The UI still renders it as a chip alongside the
     * who/where tags, so to the user all three facets look and behave alike.
     */
    eventDate: text("event_date"),

    // What the file itself claimed, via EXIF. Used to prefill eventDate at
    // upload time; kept separately because the uploader may correct it.
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }),
    lat: real("lat"),
    lng: real("lng"),

    visibility: text("visibility", { enum: VISIBILITIES })
      .notNull()
      .default("public"),
    status: text("status", { enum: MEDIA_STATUSES })
      .notNull()
      .default("processing"),

    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("media_event_date_idx").on(t.eventDate),
    index("media_owner_idx").on(t.ownerId),
    index("media_created_idx").on(t.createdAt),
    index("media_feed_idx").on(t.visibility, t.status, t.createdAt),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    facet: text("facet", { enum: FACETS }).notNull(),
    /** Normalized form used for identity + URLs. See lib/tags/normalize.ts */
    slug: text("slug").notNull(),
    /** Human-facing form, as first typed by whoever created the tag. */
    label: text("label").notNull(),
    /**
     * Alias pointer. When two tags turn out to mean the same thing ("Aimee" and
     * "Aimee Mann"), the loser points at the winner and writes follow the
     * pointer. Nothing in v1 populates this, but the merge tool it exists for
     * is cheap to add later and impossible to retrofit cleanly.
     */
    canonicalTagId: text("canonical_tag_id"),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("tags_facet_slug_unique").on(t.facet, t.slug),
    index("tags_usage_idx").on(t.facet, t.usageCount),
  ],
);

export const mediaTags = sqliteTable(
  "media_tags",
  {
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.mediaId, t.tagId] }),
    index("media_tags_tag_idx").on(t.tagId),
  ],
);

export type User = typeof users.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Tag = typeof tags.$inferSelect;
