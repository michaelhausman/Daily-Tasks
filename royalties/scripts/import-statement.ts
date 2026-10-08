/**
 * Load a royalty statement CSV.
 *
 *   npm run import:statement -- ascap-2025-q3.csv --pro ASCAP
 *   npm run import:statement -- x.csv --pro ASCAP --from 2025-07-01 --to 2025-09-30
 *
 * --from/--to matter when the file doesn't itemise performance dates: without
 * a period, a line can't be tied to any show, and the report has to treat
 * every performance it might cover as unevidenced.
 */
import fs from "node:fs";
import path from "node:path";

import { describeDatabase } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";
import { importStatement } from "../lib/import/statement";
import { PROS, type Pro } from "../lib/db/schema";
import { formatMoney } from "../lib/text";

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--") && a.endsWith(".csv"));
  const pro = (arg("pro") ?? "ASCAP").toUpperCase() as Pro;

  if (!file) {
    console.error("Usage: npm run import:statement -- <file.csv> --pro ASCAP [--from YYYY-MM-DD --to YYYY-MM-DD]");
    process.exit(2);
  }
  if (!PROS.includes(pro)) {
    console.error(`--pro must be one of: ${PROS.join(", ")}`);
    process.exit(2);
  }

  await runMigrations();
  const result = await importStatement(fs.readFileSync(file, "utf8"), {
    pro,
    filename: path.basename(file),
    periodStart: arg("from"),
    periodEnd: arg("to"),
  });

  console.log(`Columns used — ${describeDatabase()}`);
  for (const [field, column] of Object.entries(result.mapping)) {
    console.log(`  ${field.padEnd(8)} ${column ?? "(not found)"}`);
  }

  console.log(
    `\n${result.lines} lines, ${formatMoney(result.totalCents)} total.\n` +
      `${result.itemised} name a performance date — those can be tied to a specific show.\n` +
      `${result.matchedToWorks} matched a work in the catalogue.`,
  );
  console.log(`Period: ${result.periodStart ?? "?"} to ${result.periodEnd ?? "?"}`);

  if (result.itemised === 0) {
    console.log(
      "\nNo performance dates in this file. It can still show that a work earned\n" +
        "something in the period, but not that any particular show was claimed.",
    );
  }
  if (result.unmatchedTitles.length > 0) {
    console.log(`\n${result.unmatchedTitles.length} titles matched no work:`);
    for (const t of result.unmatchedTitles.slice(0, 15)) console.log(`  ${t}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Import failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
