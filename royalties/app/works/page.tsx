import Link from "next/link";

import { unmatchedTitles } from "@/lib/import/catalog";
import { unclaimedSummary } from "@/lib/report/unclaimed";
import { formatMoney } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function WorksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = (Array.isArray(params.tab) ? params.tab[0] : params.tab) ?? "mine";

  const [summary, unmatched] = await Promise.all([
    unclaimedSummary(),
    unmatchedTitles(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Works</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/works"
            className="chip text-xs"
            style={
              tab === "mine" ? { borderColor: "#7c5cff", color: "#7c5cff" } : undefined
            }
          >
            Yours ({summary.byWork.length})
          </Link>
          <Link
            href="/works?tab=unmatched"
            className="chip text-xs"
            style={
              tab === "unmatched"
                ? { borderColor: "#c27803", color: "#c27803" }
                : undefined
            }
          >
            Unmatched titles ({unmatched.length})
          </Link>
        </div>
      </header>

      {tab === "unmatched" ? (
        <>
          <p className="max-w-3xl text-sm muted">
            Titles played that match nothing in the catalogue. Each is either a
            cover — someone else&rsquo;s money, nothing to do — or one of your
            songs the catalogue import missed, in which case every performance
            of it is invisible to every number in this app. The ones played
            most are worth checking first.
          </p>
          {unmatched.length === 0 ? (
            <p className="text-sm muted">Nothing unmatched.</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {unmatched.map((row) => (
                <li
                  key={row.titleKey}
                  className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm"
                >
                  <span className="font-medium">{row.title}</span>
                  <span className="flex-1" />
                  <span className="text-xs muted">
                    {row.performances}{" "}
                    {row.performances === 1 ? "performance" : "performances"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : summary.byWork.length === 0 ? (
        <p className="text-sm muted">
          No works with a tracked writer yet.{" "}
          <Link href="/import" style={{ color: "#7c5cff" }}>
            Import a catalogue
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {summary.byWork.map((work) => (
            <li
              key={work.workId}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 font-medium">{work.title}</span>
              <span className="text-xs muted">{work.performances} played</span>
              <span
                className="text-xs"
                style={{ color: work.unclaimed > 0 ? "#f05252" : "#0e9f6e" }}
              >
                {work.unclaimed} unclaimed
              </span>
              {work.claimableNow > 0 && (
                <span className="text-xs" style={{ color: "#7c5cff" }}>
                  {work.claimableNow} still filable
                </span>
              )}
              <span className="w-20 text-right text-xs tabular-nums muted">
                {formatMoney(work.paidCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
