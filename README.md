# Tagpool

A photo, video, and audio sharing community where uploads pool together by
**who**, **where**, and **when** — so everyone's media from the same event ends
up on one page automatically.

Upload a clip from the Aimee Mann show at the Eau Claire festival on July 24 and
tag it with those three things. Anyone else who was there and tagged the same
three lands in the same pool as you, without either of you creating a group,
joining an event, or knowing the other exists.

## Quick start

```bash
npm install
npm run db:migrate
npm run seed        # optional, but the app is more interesting with it
npm run dev
```

Then open http://localhost:3000. The seed data includes the example above:

    http://localhost:3000/m/aimee-mann/eau-claire-festival/2026-07-24

Seeded accounts are `michael`, `dana_k`, `rivera`, `toneflora` — password
`password123` for all of them.

To start over: `rm -rf .data && npm run db:migrate && npm run seed`.

## The idea, and why the schema looks like this

Ordinary tags fragment. Two people at the same show type "Aimee Mann" and
"aimee mann", get two tag rows, and their uploads never meet. Worse, the failure
is silent — each person sees their own upload sitting alone and concludes nobody
else posted.

Three decisions prevent that:

**Tags are faceted, not freeform.** Every tag is a *who*, a *where*, or a
*topic*. Namespacing means "First Avenue" the venue can't collide with a
performer of the same name, and it lets the browse UI ask coherent questions.

**Identity is the slug, not the label.** `slugify()` in
[`lib/tags/normalize.ts`](lib/tags/normalize.ts) folds case, whitespace,
punctuation, and diacritics, so `Aimee Mann`, `aimee mann`, `AIMEE MANN`, and
`Aimée  Mann` are all one tag. The first-typed spelling is kept for display.

**The date is a column, not a tag.** This is the one that matters most. As a
tag, "July 24th" / "7/24" / "24 July 2026" / "2026-07-24" are four rows and the
pool splits four ways. As a `DATE` column it's one value, it sorts, and it
supports range queries a tag never could. The UI still renders it as a chip
beside the others — the distinction is invisible to users.

On top of that, the upload form's typeahead shows existing tags with their usage
counts while you type. Preventing a duplicate at creation time is worth far more
than any after-the-fact merge tool.

### Moments are derived, not stored

A **moment** is any (who, where, date) triple that has uploads. Nothing creates
it; it's a `GROUP BY` in
[`findMoments()`](lib/media/queries.ts). A moment springs into existence the
instant the second person tags correctly, with no backfill and nothing to keep
in sync.

### Filter semantics

- **OR within a facet** — two performers means "either performer"
- **AND across facets** — performer + venue + date means all three must hold

So picking only "Aimee Mann" gives everything of hers; adding the venue and date
narrows to one show. That progressive narrowing is the whole browse experience,
and it falls out of one rule in `facetCondition()`.

## Stack

- **Next.js 16** (App Router) — SSR pages plus the JSON API a native client
  would consume
- **SQLite + Drizzle** — behind an adapter; the Postgres move is a driver swap
- **Local disk storage** — behind [`StorageDriver`](lib/storage/index.ts), with
  an `S3Driver` stub against the same interface
- **scrypt + DB-backed sessions** — no external auth provider, nothing to sign
  up for
- **sharp** for image derivatives and EXIF; **ffmpeg optional**

### ffmpeg is optional

Without it, video and audio still upload, store, and play — they just lack a
poster frame and a waveform. Every probe in
[`lib/media/probe.ts`](lib/media/probe.ts) degrades to `null` rather than
failing the upload. Install ffmpeg to get both.

## Layout

```
app/
  api/uploads/         upload + inline processing
  api/files/[...key]/  file serving with HTTP range support
  api/tags/suggest/    typeahead
  m/[who]/[where]/[date]/   the pooled moment page
  explore/             faceted chip browser
  media/[id]/          detail + per-kind player
lib/
  tags/normalize.ts    slugify — tag identity lives here
  tags/service.ts      lookup-or-create, alias following, suggestions
  media/queries.ts     faceted filtering + moment derivation
  media/process.ts     derivatives, EXIF
  storage/             pluggable object storage
```

## Known limits

Deliberately out of scope for this first version:

- **No video transcoding** — originals are served as uploaded, so a phone's
  HEVC `.mov` may not play in every browser
- **Processing is inline** with the upload request; it belongs in a job queue
  before real traffic
- **No moderation tooling** — no reporting, no takedown queue. Needed before
  this is open to the public
- No follows, likes, or comments; no email verification or password reset
- Tag merging has schema support (`tags.canonical_tag_id`, followed on write)
  but no admin UI yet
