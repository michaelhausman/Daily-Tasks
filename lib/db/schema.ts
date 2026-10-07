import {
  boolean,
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
    /**
     * Suspension blocks login and hides everything the account posted, without
     * destroying any of it. Reversible on purpose — an account is a person, and
     * getting it wrong should cost an apology rather than their whole archive.
     */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
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

    /**
     * Moderation hide, kept separate from `status` (which is about processing)
     * and from deletion (which is irreversible).
     *
     * This distinction is the most useful thing in the moderation toolkit. Faced
     * with something borderline, a moderator whose only option is permanent
     * deletion will either destroy something they were unsure about or leave it
     * up while they think. Hide removes it from every listing instantly, keeps
     * the bytes, and can be undone.
     */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: text("hidden_by"),
    hiddenReason: text("hidden_reason"),

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

export const likes = pgTable(
  "likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mediaId] }),
    index("likes_media_idx").on(t.mediaId),
  ],
);

/**
 * Comments attach to either a single upload or a whole moment.
 *
 * Moments have no row of their own — they're derived from (where, when) — so a
 * moment comment stores that pair directly rather than a foreign key. A CHECK
 * constraint in migrate.ts enforces that exactly one target is set.
 *
 * Moment-level comments matter more here than they would elsewhere: "what was
 * CBGB like that night" is a conversation about the event, not about one
 * person's photo of it.
 */
export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),

    mediaId: text("media_id").references(() => media.id, {
      onDelete: "cascade",
    }),
    momentWhere: text("moment_where"),
    momentDate: date("moment_date", { mode: "string" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("comments_media_idx").on(t.mediaId, t.createdAt),
    index("comments_moment_idx").on(t.momentWhere, t.momentDate, t.createdAt),
  ],
);

export const tagFollows = pgTable(
  "tag_follows",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tagId] }),
    index("tag_follows_tag_idx").on(t.tagId),
  ],
);

/** Same derived-key reasoning as moment comments: no moment row to point at. */
export const momentFollows = pgTable(
  "moment_follows",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    whereSlug: text("where_slug").notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.whereSlug, t.eventDate] }),
    index("moment_follows_key_idx").on(t.whereSlug, t.eventDate),
  ],
);

/**
 * A show that is known to have happened, whether or not anyone has posted from
 * it yet: a performer at a place on a day, imported from a touring history.
 *
 * This is the one exception to "moments are derived". A moment born from
 * uploads needs a second person to tag correctly before it exists, and the
 * first person to arrive finds nothing — the cold start the whole product
 * stands or falls on. A show row lets a moment exist *before* its first upload,
 * so that person lands on a page that already knows who played and what was in
 * the setlist, and their upload has somewhere to go.
 *
 * Shows reference tags rather than storing labels, so they pool with uploads
 * by exactly the same (where slug, date) rule and follow tag merges.
 */
export const shows = pgTable(
  "shows",
  {
    id: text("id").primaryKey(),
    whoTagId: text("who_tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    whereTagId: text("where_tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    city: text("city"),
    region: text("region"),
    tour: text("tour"),
    /** Song titles in running order, as JSON — same convention as waveformJson. */
    setlistJson: text("setlist_json"),
    setlistUrl: text("setlist_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("shows_who_where_date_unique").on(
      t.whoTagId,
      t.whereTagId,
      t.eventDate,
    ),
    index("shows_where_date_idx").on(t.whereTagId, t.eventDate),
    index("shows_event_date_idx").on(t.eventDate),
  ],
);

export const IMPORT_STATUSES = [
  "queued",
  "fetching",
  "importing",
  "done",
  "failed",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * One run of "fetch an artist from setlist.fm and load their shows".
 *
 * The row exists because the work outlives the request that asked for it: a
 * long career is seventy API pages at 600ms apart, minutes of waiting that no
 * browser or router will hold open. The admin page starts the job, the job
 * writes its progress here, and the page polls the row — so a refresh, a phone
 * going to sleep, or closing the tab doesn't abandon the import.
 *
 * `heartbeatAt` is how a dead job is spotted. Nothing outside the server
 * process tracks whether a job is still running, so if the container restarts
 * mid-fetch the row would otherwise claim to be fetching forever. A stale
 * heartbeat frees the lock, and re-running is safe because importing is
 * idempotent on (performer, place, day).
 */
export const showImports = pgTable(
  "show_imports",
  {
    id: text("id").primaryKey(),
    /** Artist name as setlist.fm spells it, which is what the tag is made from. */
    performer: text("performer").notNull(),
    /** MusicBrainz id — the thing that distinguishes two bands sharing a name. */
    mbid: text("mbid"),
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("queued"),

    page: integer("page").notNull().default(0),
    pages: integer("pages").notNull().default(0),
    fetched: integer("fetched").notNull().default(0),
    added: integer("added").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    /** Venue spellings matched to a show already on file, so no page split. */
    aligned: integer("aligned").notNull().default(0),

    error: text("error"),
    startedBy: text("started_by").references(() => users.id, {
      onDelete: "set null",
    }),

    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("show_imports_created_idx").on(t.createdAt)],
);

/**
 * A person's answer to "are these two venue names the same room?".
 *
 * Importing can tell that "The Birchmere" and "Birchmere" are one place, but
 * not that the Kitty Carlisle Hart Theatre is inside The Egg. Those need
 * someone who knows, and the answer has to outlive the import that asked —
 * otherwise every re-sync asks again, and whoever is clicking eventually
 * guesses. Same shape as the hand-written `data/shows/venues.json`, because it
 * is the same decision: `names` are spellings of one room in that city, and
 * `different` marks two places that merely shared a night.
 */
export const venueDecisions = pgTable(
  "venue_decisions",
  {
    id: text("id").primaryKey(),
    city: text("city").notNull(),
    /** Venue names, without the city — JSON array, same convention as setlistJson. */
    namesJson: text("names_json").notNull(),
    /** Null means every night; set when the names only coincide on one date. */
    eventDate: date("event_date", { mode: "string" }),
    different: boolean("different").notNull().default(false),
    note: text("note"),
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("venue_decisions_city_idx").on(t.city)],
);

export const REPORT_REASONS = [
  "copyright",
  "abuse",
  "sexual",
  "spam",
  "wrong-tags",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["open", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * A report points at exactly one of: an upload, a comment, or a moment.
 *
 * Moments are included because they're shared space nobody owns — anyone can
 * add to CBGB on 12 June 1975, so there's no uploader whose judgement covers
 * the page as a whole. "wrong-tags" exists as a reason for the same reason:
 * a mistagged upload quietly pollutes someone else's pool, which is a
 * data-quality problem here rather than an abuse one, but it still needs
 * reporting.
 */
export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: REPORT_REASONS }).notNull(),
    note: text("note"),
    status: text("status", { enum: REPORT_STATUSES }).notNull().default("open"),

    mediaId: text("media_id").references(() => media.id, {
      onDelete: "cascade",
    }),
    commentId: text("comment_id").references(() => comments.id, {
      onDelete: "cascade",
    }),
    momentWhere: text("moment_where"),
    momentDate: date("moment_date", { mode: "string" }),

    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("reports_status_idx").on(t.status, t.createdAt),
    index("reports_media_idx").on(t.mediaId),
  ],
);

export type User = typeof users.$inferSelect;
export type Media = typeof media.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Show = typeof shows.$inferSelect;
export type ShowImport = typeof showImports.$inferSelect;
export type VenueDecisionRow = typeof venueDecisions.$inferSelect;
