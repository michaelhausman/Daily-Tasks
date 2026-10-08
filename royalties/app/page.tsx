import Link from "next/link";

import { unclaimedSummary } from "@/lib/report/unclaimed";

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone?: string;
  note?: string;
}) {
  return (
    <div className="surface rounded-xl p-4">
      <p className="text-xs uppercase tracking-wider muted">{label}</p>
      <p className="mt-1 text-2xl font-bold" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
      {note && <p className="mt-1 text-xs muted">{note}</p>}
    </div>
  );
}

export default async function HomePage() {
  const summary = await unclaimedSummary();
  const t = summary.totals;
  const empty = t.performances === 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Unclaimed performances</h1>
        <p className="mt-2 max-w-3xl text-sm muted">
          A live performance earns a writer money only if the PRO is told it
          happened — through ASCAP OnStage or BMI Live, within their window.
          The licence fee on a concert contract goes into a pool and is spread
          across everything that pool covers; it was never earmarked for these
          writers. So nothing here treats it as money owed. What it looks for
          is performances that were never submitted, which is where the
          recoverable money actually is.
        </p>
      </header>

      {empty ? (
        <div className="surface rounded-xl p-8 text-center">
          <p className="font-semibold">Nothing loaded yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm muted">
            Start with the catalogue, so the app knows which songs are yours,
            then the setlists, then the statements.
          </p>
          <Link href="/import" className="btn btn-primary mt-4 inline-block">
            Import data
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Performances"
              value={t.performances.toLocaleString()}
              note={`${t.ourPerformances.toLocaleString()} of works you hold a share in`}
            />
            <Stat
              label="Itemised as paid"
              value={t.paid.toLocaleString()}
              tone="#0e9f6e"
              note="a statement names the work and the date"
            />
            <Stat
              label="No statement"
              value={t.none.toLocaleString()}
              tone="#f05252"
              note="nothing mentions the work near that date"
            />
            <Stat
              label="Still claimable"
              value={t.claimableNow.toLocaleString()}
              tone="#7c5cff"
              note={`inside a ${summary.windowDays}-day window`}
            />
          </div>

          {t.inPeriod > 0 && (
            <p className="surface rounded-xl p-4 text-sm muted">
              <strong style={{ color: "var(--text)" }}>
                {t.inPeriod.toLocaleString()} performances
              </strong>{" "}
              sit inside a period a statement covers, but that statement
              doesn&rsquo;t itemise performances — so it shows the work earned
              something that quarter, not that this night was claimed. Treat
              those as unproven rather than paid.
            </p>
          )}

          {t.unmatchedTitles > 0 && (
            <p className="surface rounded-xl p-4 text-sm muted">
              <strong style={{ color: "#c27803" }}>
                {t.unmatchedTitles.toLocaleString()} performances
              </strong>{" "}
              are of titles that match nothing in the catalogue. Some are
              covers — someone else&rsquo;s money. The rest are your songs,
              missing from the catalogue and invisible to every number above.{" "}
              <Link href="/works?tab=unmatched" style={{ color: "#7c5cff" }}>
                Sort them out →
              </Link>
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Link href="/claims" className="btn btn-primary">
              See what to file
            </Link>
            <Link href="/works" className="btn btn-ghost">
              By work
            </Link>
          </div>

          <p className="text-xs muted">
            Claim window assumed to be {summary.windowDays} days
            (CLAIM_WINDOW_DAYS). ASCAP and BMI have each changed their
            deadlines before — confirm against their current rules before
            relying on the claimable count.
          </p>
        </>
      )}
    </div>
  );
}
