/** Print the unclaimed-performance report. */
import { runMigrations } from "../lib/db/migrate";
import { claimableShows, unclaimedSummary } from "../lib/report/unclaimed";
import { formatMoney } from "../lib/text";

async function main() {
  await runMigrations();
  const summary = await unclaimedSummary();
  const t = summary.totals;

  console.log(`Performances on file:        ${t.performances.toLocaleString()}`);
  console.log(`  of tracked writers' works: ${t.ourPerformances.toLocaleString()}`);
  console.log(`  titles matching no work:   ${t.unmatchedTitles.toLocaleString()}`);
  console.log("");
  console.log(`Itemised as paid:            ${t.paid.toLocaleString()}`);
  console.log(`Only covered by a period:    ${t.inPeriod.toLocaleString()}`);
  console.log(`No statement at all:         ${t.none.toLocaleString()}`);
  console.log("");
  console.log(`Still inside the ${summary.windowDays}-day window: ${t.claimableNow.toLocaleString()}`);

  const shows = await claimableShows();
  if (shows.length > 0) {
    console.log(`\nShows worth filing, soonest deadline first:`);
    for (const show of shows.slice(0, 25)) {
      console.log(
        `  ${show.eventDate}  ${String(show.daysLeft).padStart(3)}d left  ` +
          `${show.titles.length} songs  ${show.venue ?? show.city ?? ""}`,
      );
    }
  }

  if (summary.byWork.length > 0) {
    console.log(`\nBy work:`);
    for (const work of summary.byWork.slice(0, 20)) {
      console.log(
        `  ${String(work.unclaimed).padStart(4)} unclaimed of ${String(work.performances).padEnd(5)} ` +
          `${formatMoney(work.paidCents).padStart(10)}  ${work.title}`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
