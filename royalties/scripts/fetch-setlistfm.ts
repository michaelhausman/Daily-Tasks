/**
 * Pull an artist's shows and setlists from setlist.fm straight into the
 * database.
 *
 *   npm run fetch:setlistfm -- "Aimee Mann"
 *   npm run fetch:setlistfm -- "Aimee Mann" --mbid <id>
 *
 * Safe to re-run: shows are keyed on artist, venue and day, so a second run
 * updates in place and replaces each setlist with the current one.
 */
import fs from "node:fs";

import { describeDatabase } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";
import { importShows } from "../lib/import/shows";
import { fetchSetlists, findArtist, toShowInput } from "../lib/setlistfm";

async function main() {
  if (!process.env.SETLISTFM_API_KEY && fs.existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }
  const apiKey = process.env.SETLISTFM_API_KEY?.trim();
  if (!apiKey) {
    console.error("No SETLISTFM_API_KEY. Put it in .env.local.");
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
    console.error(`"${name}" matches ${matches.length} artists:`);
    for (const a of matches) {
      console.error(`  --mbid ${a.mbid}  ${a.name}${a.disambiguation ? ` (${a.disambiguation})` : ""}`);
    }
    process.exit(1);
  }

  await runMigrations();

  const setlists = await fetchSetlists(apiKey, artist.mbid, (page, pages) => {
    process.stdout.write(`\r  page ${page} of ${pages}`);
  });
  process.stdout.write("\n");

  const shows = setlists
    .map((s) => toShowInput(s, artist.name))
    .filter((s) => s !== null);

  const result = await importShows(shows, { source: "setlistfm", mbid: artist.mbid });

  console.log(
    `${artist.name}: ${result.showsAdded} shows added, ${result.showsUpdated} updated, ` +
      `${result.performancesWritten} performances (${result.matchedToWorks} matched to works) — ${describeDatabase()}`,
  );
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length}:`);
    for (const s of result.skipped.slice(0, 20)) console.log(`  ${s}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fetch failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
