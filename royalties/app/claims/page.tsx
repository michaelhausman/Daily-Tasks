import Link from "next/link";

import { claimableShows, unclaimedSummary } from "@/lib/report/unclaimed";

export const dynamic = "force-dynamic";

/**
 * The worklist: shows still inside the claim window, soonest deadline first.
 *
 * Grouped by show rather than by song because that is the shape of a claim —
 * OnStage and BMI Live take a setlist for a date and a venue, not one title
 * at a time. A page listing individual songs would be a list nobody could act
 * on without reassembling it by hand.
 */
export default async function ClaimsPage() {
  const [shows, summary] = await Promise.all([
    claimableShows(),
    unclaimedSummary(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Worth filing</h1>
        <p className="mt-2 max-w-3xl text-sm muted">
          Shows with performances of your works and no statement line naming
          that date, still inside the {summary.windowDays}-day window. Soonest
          deadline first — these are the ones that expire.
        </p>
      </header>

      {shows.length === 0 ? (
        <div className="surface rounded-xl p-8 text-center">
          <p className="font-semibold">Nothing claimable right now.</p>
          <p className="mx-auto mt-2 max-w-md text-sm muted">
            Either everything recent is accounted for, or the setlists and
            statements needed to tell aren&rsquo;t loaded yet.{" "}
            <Link href="/import" style={{ color: "#7c5cff" }}>
              Import data
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm muted">
            {shows.length} {shows.length === 1 ? "show" : "shows"}
          </p>
          <ul className="space-y-2">
            {shows.map((show) => (
              <li key={show.showId} className="surface rounded-xl p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">
                    {show.eventDate}
                  </span>
                  <span className="min-w-0 flex-1">
                    {show.venue ?? show.city ?? "—"}
                    {show.venue && show.city && (
                      <span className="muted">, {show.city}</span>
                    )}
                    <span className="block text-xs muted">{show.artist}</span>
                  </span>
                  <span
                    className="shrink-0 text-xs font-medium"
                    style={{
                      color: show.daysLeft < 30 ? "#f05252" : "#c27803",
                    }}
                  >
                    {show.daysLeft} days left
                  </span>
                </div>

                <p className="mt-2 text-sm">
                  <span className="muted">
                    {show.titles.length}{" "}
                    {show.titles.length === 1 ? "song" : "songs"}:{" "}
                  </span>
                  {show.titles.join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
