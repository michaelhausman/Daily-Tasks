/**
 * Load a touring history so every show has a moment page before anyone posts.
 *
 *   npm run import:shows -- data/shows/aimee-mann.json
 *
 * Safe to re-run: shows are keyed on performer, place and day, so a second run
 * updates details in place. Against production, set DATABASE_URL first.
 */
import fs from "node:fs";

import { describeDatabase } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";
import { importShows, type ShowInput } from "../lib/shows/service";

type ShowFile = { performer: string; shows: ShowInput[] };

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run import:shows -- <file.json>");
    process.exit(2);
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8")) as ShowFile;
  if (!data.performer || !Array.isArray(data.shows)) {
    throw new Error(`${file}: expected { performer, shows: [...] }`);
  }

  await runMigrations();
  const { added, updated, skipped } = await importShows(data.performer, data.shows);

  console.log(
    `${data.performer}: ${added} shows added, ${updated} updated — ${describeDatabase()}`,
  );
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} without a valid date or city:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  });
