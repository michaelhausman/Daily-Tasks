/**
 * Download an artist's shows from setlist.fm into a touring-history file.
 *
 *   npm run fetch:setlistfm -- "Jonathan Coulton"
 *   npm run fetch:setlistfm -- "Jonathan Coulton" --mbid <id>   # if the name is ambiguous
 *
 * Writes data/shows/<artist>.json, which `npm run import:shows` then loads.
 * Fetching and importing are separate on purpose: the API key stays on this
 * machine, and the server only ever sees the data file — which can be read
 * and checked before it goes live.
 *
 * Needs SETLISTFM_API_KEY, from the environment or .env.local.
 */
import fs from "node:fs";
import path from "node:path";

import {
  alignVenues,
  type VenueDecision,
  fetchSetlists,
  findArtist,
  mergeSameShow,
  toShowInput,
} from "../lib/shows/setlistfm";
import type { ShowInput } from "../lib/shows/service";
import { slugify } from "../lib/tags/normalize";

async function main() {
  // .env.local is git-ignored, which is where the key belongs.
  if (!process.env.SETLISTFM_API_KEY && fs.existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const apiKey = process.env.SETLISTFM_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "No SETLISTFM_API_KEY. Put a line `SETLISTFM_API_KEY=<your key>` in .env.local.",
    );
    process.exit(2);
  }

  const args = process.argv.slice(2);
  const mbidAt = args.indexOf("--mbid");
  const mbidArg = mbidAt >= 0 ? args[mbidAt + 1] : undefined;
  const name = (mbidAt >= 0 ? [...args.slice(0, mbidAt), ...args.slice(mbidAt + 2)] : args)
    .join(" ")
    .trim();
  if (!name) {
    console.error('Usage: npm run fetch:setlistfm -- "Artist Name" [--mbid <id>]');
    process.exit(2);
  }

  const matches = await findArtist(apiKey, name);
  const artist = mbidArg ? matches.find((a) => a.mbid === mbidArg) : matches[0];

  if (!artist) {
    console.error(`setlist.fm has no artist named exactly "${name}".`);
    process.exit(1);
  }
  if (!mbidArg && matches.length > 1) {
    // Two bands can share a name; guessing would file one band's shows under
    // the other's tag, which nobody would notice until a fan did.
    console.error(`"${name}" matches ${matches.length} artists on setlist.fm:`);
    for (const a of matches) {
      console.error(`  --mbid ${a.mbid}  ${a.name}${a.disambiguation ? ` (${a.disambiguation})` : ""}`);
    }
    console.error("Re-run with --mbid to pick one.");
    process.exit(1);
  }

  console.log(`${artist.name}${artist.disambiguation ? ` (${artist.disambiguation})` : ""} — ${artist.mbid}`);

  const setlists = await fetchSetlists(apiKey, artist.mbid, (page, pages) => {
    process.stdout.write(`\r  page ${page} of ${pages}`);
  });
  process.stdout.write("\n");

  const usable = setlists.map(toShowInput).filter((s) => s !== null);
  const file = path.join("data", "shows", `${slugify(artist.name)}.json`);

  // Every other artist already on file, so shared nights land on one moment.
  const dir = path.dirname(file);
  const existing = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json") && f !== "venues.json" && path.join(dir, f) !== file)
        .flatMap((f) => (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).shows ?? []) as ShowInput[])
    : [];
  const decisionsFile = path.join(dir, "venues.json");
  const decisions: VenueDecision[] = fs.existsSync(decisionsFile)
    ? JSON.parse(fs.readFileSync(decisionsFile, "utf8")).decisions ?? []
    : [];

  const { rows: aligned, report } = alignVenues(usable, existing, decisions);
  const shows = mergeSameShow(aligned);
  const withSongs = shows.filter((s) => s.setlist?.length).length;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        performer: artist.name,
        source: `setlist.fm, artist ${artist.mbid}, fetched ${new Date().toISOString().slice(0, 10)}. Each show links back to its setlist.fm page.`,
        shows,
      },
      null,
      1,
    ) + "\n",
  );

  console.log(
    `${setlists.length} setlists → ${shows.length} shows (${withSongs} with songs), ` +
      `${shows[0]?.date.slice(0, 4) ?? "—"}–${shows.at(-1)?.date.slice(0, 4) ?? "—"}`,
  );
  if (setlists.length - usable.length > 0) {
    console.log(`Skipped ${setlists.length - usable.length} with no date or city.`);
  }
  if (report.aligned.length > 0) {
    console.log(`Matched ${report.aligned.length} venue spellings to shows already on file.`);
  }
  if (report.unresolved.length > 0) {
    console.log(
      `\n${report.unresolved.length} nights share a city and date with a show on file under a different venue name.`,
    );
    console.log("If any are the same place, record it in data/shows/venues.json and re-run:");
    for (const u of report.unresolved) {
      console.log(`  ${u.date}  ${u.city}: "${u.ours}" vs ${u.theirs.map((t) => `"${t}"`).join(", ")}`);
    }
    console.log("");
  }
  console.log(`Wrote ${file}. Load it with: npm run import:shows -- ${file}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
