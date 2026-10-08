# Performance Royalties

Finds live performances that were never claimed, by lining up three things:
**what was played**, **whose song it was**, and **what was paid**.

## The thing to understand first

A live performance earns a writer money only if the PRO is told it happened.

Venues and promoters buy blanket licences; that money goes into a pool and is
distributed across everything the pool covers. Historically live money was
spread by survey, so the writers of the songs actually played on a given night
were paid nothing *for that night*. **ASCAP OnStage** and **BMI Live** exist to
fix exactly that: the performing writer submits their own setlists, within a
deadline, and is paid for those specific performances.

Two consequences shape this whole app:

1. **The PRO line in a concert contract is not a debt owed to these writers.**
   Nothing here subtracts receipts from it. A report claiming a shortfall on
   that basis would be wrong, and wrong in a way that falls apart under
   scrutiny.

2. **A performance with no matching statement line was probably never
   submitted** — and if it is still inside the window, it still can be. That
   is the recoverable money, and it is what every screen here is pointed at.

## Evidence has strengths, and they are kept apart

| | meaning |
|---|---|
| **paid** | a statement itemises that work on that exact date. Proof. |
| **period only** | a statement covering that date pays that work but doesn't itemise. The earnings could be radio, streaming, or another night. |
| **no statement** | nothing mentions the work anywhere near the date. |

Collapsing *period only* into *paid* is the easy mistake, and it would hide
precisely the performances worth chasing. So it isn't.

## Loading data

Order matters once: load the catalogue first so the app knows which songs are
yours. Setlists and statements loaded before it are matched retroactively, but
nothing reads as *yours* until a catalogue says so.

```bash
npm install
npm run db:migrate

# 1. the catalogue — export your Google Sheet as CSV
npm run import:catalog -- catalog.csv --tracked "Mann, Aimee"

# 2. setlists
npm run fetch:setlistfm -- "Aimee Mann"        # needs SETLISTFM_API_KEY
npm run import:shows -- extra-shows.json        # dates setlist.fm lacks

# 3. statements
npm run import:statement -- ascap-q3.csv --pro ASCAP

npm run report:unclaimed
npm run dev                                     # the same thing, as pages
```

The catalogue and statement uploads also work from **/import** in the browser,
which is usually easier. Column names are guessed from their headers and the
guess is always reported, so a wrong one is visible rather than silent.

## What the matching does

Three sources spell a song three ways: a fan typing a setlist, a PRO's data
entry, and a publisher's export. Matching happens on a folded key —
case, punctuation, accents, ampersands, a leading "The", and a *trailing*
parenthetical, so `Save Me (from Magnolia)` and `save me` are one song. A
leading parenthetical is kept, because `(Don't Fear) The Reaper` is the title.

Anything the fold gets wrong is fixed with an explicit alias rather than a
cleverer function, which keeps it predictable.

A setlist title matching no work is **kept, with a null work**. That is not an
incomplete record, it's the to-do list: each is either a cover (someone else's
money) or one of your songs missing from the catalogue — invisible to every
number in the app until it's added. **/works?tab=unmatched** ranks them by how
often they were played.

## Not built yet

- **Contracts.** The `contracts` table exists — gross, the PRO fee line, who
  held the licence — but nothing parses a PDF deal memo into it. It answers
  "was this venue licensed at all", which is a precondition for claiming, not
  a number to reconcile against.
- **Publisher-to-writer pass-through.** A different reconciliation (publisher
  statement against writer statement) that needs both sides.
- **Filing.** This finds what to claim. Submitting is still done on ASCAP's or
  BMI's own site.

## Configuration

See `.env.example`. The one worth attention is `CLAIM_WINDOW_DAYS`
(default 180): how long after a performance it can still be submitted. ASCAP
and BMI have each changed this, so confirm it against their current rules
before trusting the claimable count. It's surfaced on the dashboard as an
assumption for that reason.

## Why it lives in this repo

It shouldn't, particularly, and it doesn't depend on anything outside this
directory — own `package.json`, own schema, own database, own deploy. It is
here only because the session that wrote it couldn't create a repository.
Moving it out is a copy of this directory into a fresh repo; nothing imports
across the boundary. The setlist.fm client is duplicated from the Tagpool app
on purpose, so that an app holding contracts and royalty statements never has
to build a public photo site to run.
