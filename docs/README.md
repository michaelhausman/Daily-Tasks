# Documents

Everything written about the project, as opposed to the code itself.

| File | What it is |
|---|---|
| `project-paper.html` | Project paper for a friends-and-family raise — problem, insight, what's built, risks, technical appendix. Source for the PDF in the repo root. |
| `deploy-checklist.html` | Eight-step Railway deployment checklist with tickable boxes. |
| `app-tour.html` | Visual tour of the app with embedded screenshots. **See the note below.** |
| `app-tour.template.html` | The tour before screenshots were inlined. Kept because the built file is 256KB of base64 and unpleasant to edit by hand. |

The two other documents live in the repo root because that's where people look
for them: [`README.md`](../README.md) for how the project works, and
[`DEPLOY.md`](../DEPLOY.md) for deployment reference.

House rules and the takedown process aren't here — they're pages the live site
serves, at `/rules` and `/takedown`, generated from `app/rules/` and
`app/takedown/`.

## These are published as private web pages

Each HTML file here is also live at a claude.ai artifact URL. Editing the file
doesn't update the published page — that takes a redeploy, so ask for one after
changing anything you want reflected in the link.

## The tour is out of date

`app-tour.html` was written before moments were redefined. It still shows the
old three-part URL (`/m/aimee-mann/eau-claire-festival/2026-07-24`) and
describes tagging as *who, where, and when*, when a moment is now just a place
and a date with the performer optional.

Old links still redirect, so nothing is broken — but the screenshots predate
likes, comments, following, moderation, and editing. Regenerating it means
retaking every screenshot against the current app.

## Regenerating the PDF

`Tagpool-project-paper.pdf` is rendered from `project-paper.html` through a
headless browser using the `@media print` rules at the bottom of that file.
It isn't wired to an npm script, because that would mean carrying a browser
automation dependency in `package.json` for something done a handful of times.
Ask and it gets rebuilt.
