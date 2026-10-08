import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * What this models, and what it deliberately doesn't.
 *
 * A live performance earns a writer money only if somebody tells the PRO it
 * happened. Venues and promoters pay for blanket licences, that money lands in
 * a pool, and historically it was distributed by survey — so the writers of the
 * songs actually played that night were paid nothing *for that night*. ASCAP
 * OnStage and BMI Live exist to fix exactly that: the performing writer submits
 * their own setlists and is paid for those specific performances.
 *
 * So the fee on a concert contract is not a debt owed to these writers, and
 * nothing here treats it as one. The question this schema is shaped to answer
 * is narrower and far more useful: **which performances were never claimed?**
 * For that you need three things lined up — what was played (performances),
 * whose work it was (works and writers), and what was paid (statement lines) —
 * and the gap between the first and the third is the recoverable money.
 */

export const PROS = ["ASCAP", "BMI", "SESAC", "GMR", "PRS", "SOCAN", "other"] as const;
export type Pro = (typeof PROS)[number];

export const SHOW_SOURCES = ["setlistfm", "manual", "import"] as const;
export type ShowSource = (typeof SHOW_SOURCES)[number];

/**
 * A person who wrote songs.
 *
 * `tracked` marks the writers whose money is being audited. Everyone else
 * exists only to make the splits add up: knowing a co-writer holds 50% is what
 * makes "our share of this performance" a real number rather than a guess.
 */
export const writers = pgTable(
  "writers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    /** Interested Party Information number — the PRO's identifier for them. */
    ipi: text("ipi"),
    pro: text("pro", { enum: PROS }),
    tracked: boolean("tracked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("writers_name_key_unique").on(t.nameKey),
    index("writers_tracked_idx").on(t.tracked),
  ],
);

/**
 * A song, as the catalogue knows it.
 *
 * `titleKey` is the join to reality: setlists carry a title typed by whoever
 * logged the show, statements carry a title typed by the PRO, and the
 * catalogue carries a third. None of them agree on punctuation, articles or
 * parentheticals, so identity is the folded form — see lib/text.ts.
 */
export const works = pgTable(
  "works",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    titleKey: text("title_key").notNull(),
    /** International Standard Musical Work Code, when the catalogue has it. */
    iswc: text("iswc"),
    publisher: text("publisher"),
    /** Total writer share held by tracked writers, in basis points (10000 = 100%). */
    ourShareBp: integer("our_share_bp").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("works_title_key_unique").on(t.titleKey),
    index("works_iswc_idx").on(t.iswc),
  ],
);

/**
 * Alternate titles for one work.
 *
 * Setlists are written by fans. "Save Me" on a statement is "Save Me (from
 * Magnolia)" in the catalogue and "save me" on setlist.fm; a medley is logged
 * under three names. Rather than guess, an alias is recorded once and every
 * future import matches on it.
 */
export const workTitles = pgTable(
  "work_titles",
  {
    id: text("id").primaryKey(),
    workId: text("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    titleKey: text("title_key").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("work_titles_key_unique").on(t.titleKey),
    index("work_titles_work_idx").on(t.workId),
  ],
);

/** Who wrote what, and for how much. Shares are basis points of the writer's share. */
export const workWriters = pgTable(
  "work_writers",
  {
    workId: text("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    writerId: text("writer_id")
      .notNull()
      .references(() => writers.id, { onDelete: "cascade" }),
    shareBp: integer("share_bp").notNull().default(0),
    role: text("role"),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.writerId] }),
    index("work_writers_writer_idx").on(t.writerId),
  ],
);

/** A performing act. Kept separate from writers: performing isn't writing. */
export const artists = pgTable(
  "artists",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    /** setlist.fm's MusicBrainz id, so re-fetching can't drift onto another band. */
    mbid: text("mbid"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("artists_name_key_unique").on(t.nameKey)],
);

/**
 * One concert.
 *
 * Identified by artist, place and day — the same key the setlist sources use,
 * so re-importing updates in place. `source` records where it came from,
 * because a show typed in by hand is evidence of a different quality from one
 * setlist.fm holds, and when they disagree it matters which is which.
 */
export const shows = pgTable(
  "shows",
  {
    id: text("id").primaryKey(),
    artistId: text("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    venue: text("venue"),
    venueKey: text("venue_key"),
    city: text("city"),
    region: text("region"),
    country: text("country"),
    tour: text("tour"),
    source: text("source", { enum: SHOW_SOURCES }).notNull().default("manual"),
    setlistUrl: text("setlist_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("shows_artist_place_date_unique").on(
      t.artistId,
      t.venueKey,
      t.eventDate,
    ),
    index("shows_date_idx").on(t.eventDate),
  ],
);

/**
 * One song played at one show — the unit the whole audit turns on.
 *
 * `rawTitle` is always kept and `workId` may be null, on purpose. A setlist
 * title that matches nothing in the catalogue is not noise to be dropped: it
 * is either a cover (someone else's money, and not claimable here) or a work
 * missing from the catalogue (your money, invisible). Discarding it would hide
 * the second case, which is the expensive one.
 */
export const performances = pgTable(
  "performances",
  {
    id: text("id").primaryKey(),
    showId: text("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    workId: text("work_id").references(() => works.id, { onDelete: "set null" }),
    rawTitle: text("raw_title").notNull(),
    titleKey: text("title_key").notNull(),
    position: integer("position").notNull().default(0),
    /** Marked when a human has confirmed the title is somebody else's song. */
    notOursAt: timestamp("not_ours_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("performances_show_pos_unique").on(t.showId, t.position),
    index("performances_work_idx").on(t.workId),
    index("performances_title_idx").on(t.titleKey),
  ],
);

/**
 * The money side of a concert contract.
 *
 * Held per show, and separate from everything else, because it answers one
 * question only: was this venue licensed, and for how much? That tells you
 * whether a performance was claimable at all. It is explicitly *not* the
 * amount owed to these writers — see the note at the top of this file — so
 * nothing in the reports subtracts from it.
 */
export const contracts = pgTable(
  "contracts",
  {
    id: text("id").primaryKey(),
    showId: text("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" })
      .unique(),
    grossCents: integer("gross_cents"),
    /** The PRO/licence line in the show budget, in cents. */
    proFeeCents: integer("pro_fee_cents"),
    /** Who the promoter said holds the licence, when the contract says. */
    licensedBy: text("licensed_by"),
    note: text("note"),
    sourceFile: text("source_file"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("contracts_show_idx").on(t.showId)],
);

/** One uploaded royalty statement, as a file and a period. */
export const statements = pgTable(
  "statements",
  {
    id: text("id").primaryKey(),
    pro: text("pro", { enum: PROS }).notNull(),
    filename: text("filename").notNull(),
    /** The distribution period the statement covers. */
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    note: text("note"),
    lineCount: integer("line_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("statements_period_idx").on(t.periodStart, t.periodEnd)],
);

/**
 * One row of a statement.
 *
 * `performedOn` is the whole game. A line that names the date and venue can be
 * tied to a specific performance; one that doesn't can only be tied to a period,
 * which is much weaker evidence that a given night was paid. `raw` keeps the
 * original row so a disputed match can always be traced back to the file.
 */
export const statementLines = pgTable(
  "statement_lines",
  {
    id: text("id").primaryKey(),
    statementId: text("statement_id")
      .notNull()
      .references(() => statements.id, { onDelete: "cascade" }),
    workId: text("work_id").references(() => works.id, { onDelete: "set null" }),
    rawTitle: text("raw_title").notNull(),
    titleKey: text("title_key").notNull(),
    /** Set only when the statement itemises the individual performance. */
    performedOn: date("performed_on", { mode: "string" }),
    venue: text("venue"),
    venueKey: text("venue_key"),
    performanceCount: integer("performance_count"),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    raw: text("raw"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("statement_lines_statement_idx").on(t.statementId),
    index("statement_lines_work_idx").on(t.workId),
    index("statement_lines_title_idx").on(t.titleKey),
    index("statement_lines_performed_idx").on(t.performedOn),
  ],
);

export type Writer = typeof writers.$inferSelect;
export type Work = typeof works.$inferSelect;
export type Artist = typeof artists.$inferSelect;
export type Show = typeof shows.$inferSelect;
export type Performance = typeof performances.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Statement = typeof statements.$inferSelect;
export type StatementLine = typeof statementLines.$inferSelect;
