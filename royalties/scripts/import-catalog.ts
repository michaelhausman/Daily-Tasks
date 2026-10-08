/**
 * Load a song catalogue from a CSV — export your Google Sheet as CSV first.
 *
 *   npm run import:catalog -- catalog.csv --tracked "Aimee Mann"
 *
 * --tracked names the writers whose money is being audited; everything
 * downstream filters on it, so a run without it imports a catalogue that no
 * report will look at.
 */
import fs from "node:fs";

import { describeDatabase } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";
import { importCatalog, relinkTitles } from "../lib/import/catalog";
import { formatShare } from "../lib/text";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const trackedAt = args.indexOf("--tracked");
  const tracked = trackedAt >= 0 ? args.slice(trackedAt + 1).filter((a) => !a.startsWith("--")) : [];

  if (!file) {
    console.error('Usage: npm run import:catalog -- <file.csv> [--tracked "Writer Name" ...]');
    process.exit(2);
  }

  await runMigrations();
  const result = await importCatalog(fs.readFileSync(file, "utf8"), {
    trackedWriters: tracked,
  });

  console.log(`Columns used — ${describeDatabase()}`);
  for (const [field, column] of Object.entries(result.mapping)) {
    console.log(`  ${field.padEnd(10)} ${column ?? "(not found)"}`);
  }
  console.log(
    `\n${result.worksAdded} works added, ${result.worksUpdated} updated, ` +
      `${result.writersAdded} writers added, ${result.splitsWritten} splits.`,
  );
  if (tracked.length > 0) console.log(`Tracking: ${tracked.join(", ")}`);

  if (result.oddSplits.length > 0) {
    console.log(`\n${result.oddSplits.length} works whose writer shares don't total 100%:`);
    for (const s of result.oddSplits.slice(0, 20)) {
      console.log(`  ${formatShare(s.totalBp).padStart(8)}  ${s.title}`);
    }
    console.log("  (usually a writer row missing from the export)");
  }
  if (result.skipped.length > 0) {
    console.log(`\nSkipped ${result.skipped.length} rows.`);
  }

  const linked = await relinkTitles();
  if (linked.performances > 0 || linked.statementLines > 0) {
    console.log(
      `\nMatched ${linked.performances} existing performances and ` +
        `${linked.statementLines} statement lines to the new works.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Import failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
