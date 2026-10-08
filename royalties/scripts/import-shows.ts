/**
 * Load shows and setlists from a JSON file — for dates setlist.fm doesn't have.
 *
 *   npm run import:shows -- my-shows.json
 *
 * Shape: { "shows": [ { "artist": "...", "date": "YYYY-MM-DD", "venue": "...",
 *          "city": "...", "setlist": ["Song", ...] } ] }
 */
import fs from "node:fs";

import { describeDatabase } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";
import { importShows, type ShowInput } from "../lib/import/shows";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run import:shows -- <file.json>");
    process.exit(2);
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8")) as
    | { shows: ShowInput[] }
    | ShowInput[];
  const list = Array.isArray(data) ? data : data.shows;
  if (!Array.isArray(list)) throw new Error(`${file}: expected { shows: [...] }`);

  await runMigrations();
  const result = await importShows(list, { source: "manual" });

  console.log(
    `${result.showsAdded} added, ${result.showsUpdated} updated, ` +
      `${result.performancesWritten} performances (${result.matchedToWorks} matched) — ${describeDatabase()}`,
  );
  for (const s of result.skipped) console.log(`  skipped: ${s}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Import failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
