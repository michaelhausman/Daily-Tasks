import {
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

/**
 * Enum-like columns are plain `text` with a CHECK constraint (added in
 * migrate.ts) rather than native Postgres enum types. Postgres enums are
 * painful to alter later — adding a media kind shouldn't require a type
 * migration — and the CHECK gives the same integrity guarantee.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    avatarKey: text("avatar_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_handle_unique").on(t.handle),
    uniqueIndex("users_email_unique").on(t.email),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const media = pgTable(
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
     * The WHEN facet, as a real DATE rather than a tag row.
     *
     * This is the single most important modelling decision in the schema. As a
     * tag, "July 24th" / "7/24" / "24 July 2026" / "2026-07-24" are four
     * distinct rows and the pool silently splits four ways. As a column it is
     * one value, it sorts, and it supports range queries ("that whole festival
     * weekend") that a tag never could. The UI still renders it as a chip
     * alongside the who/where tags, so all three facets look alike to the user.
     *
     * `mode: "string"` keeps this as a plain `YYYY-MM-DD` string end to end,
     * which is what the URLs, chips, and validators all speak — and sidesteps
     * the timezone bugs a Date round-trip would introduce for a value that has
     * no time and no zone.
     */
    eventDate: date("event_date", { mode: "string" }),

    // What the file itself claimed, via EXIF. Used to prefill eventDate at
    // upload time; kept separately because the uploader may correct it.
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),

    visibility: text("visibility", { enum: VISIBILITIES })
      .notNull()
      .default("public"),
    status: text("status", { enum: MEDIA_STATUSES })
      .notNull()
      .default("processing"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("media_event_date_idx").on(t.eventDate),
    index("media_owner_idx").on(t.ownerId),
    index("media_created_idx").on(t.createdAt),
    index("media_feed_idx").on(t.visibility, t.status, t.createdAt),
  ],
);

export const tags = pgTable(
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tags_facet_slug_unique").on(t.facet, t.slug),
    index("tags_usage_idx").on(t.facet, t.usageCount),
  ],
);

export const mediaTags = pgTable(
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
