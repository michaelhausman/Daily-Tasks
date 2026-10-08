import Link from "next/link";
import { notFound } from "next/navigation";

import { FACET_COLOR } from "@/components/Chip";
import { listShowsFor, type ShowListing } from "@/lib/shows/service";
import { listToursFor } from "@/lib/shows/tours";
import { formatEventDate, isValidSlug } from "@/lib/tags/normalize";

export const dynamic = "force-dynamic";

/**
 * A performer's whole touring history, grouped by year.
 *
 * Explore lists a performer's latest moments as cards, which is right for what
 * is happening now and wrong for a career: a thousand cards is unbrowsable, so
 * it stops at the newest sixty. This page is the rest — every show as one line,
 * under its year, with a jump bar so 1988 is a click away.
 */
export default async function ShowsPage({
  params,
}: {
  params: Promise<{ who: string }>;
}) {
  const { who } = await params;
  if (!isValidSlug(who)) notFound();

  const [{ performer, shows }, tours] = await Promise.all([
    listShowsFor(who),
    listToursFor(who),
  ]);
  if (!performer || shows.length === 0) notFound();

  const byYear = new Map<string, ShowListing[]>();
  for (const show of shows) {
    const year = show.eventDate.slice(0, 4);
    const list = byYear.get(year) ?? [];
    list.push(show);
    byYear.set(year, list);
  }
  const years = [...byYear.keys()];

  const withSetlists = shows.filter((s) => s.songCount > 0).length;
  const withUploads = shows.filter((s) => s.mediaCount > 0).length;

  return (
    <div className="space-y-6">
      <header className="surface rounded-2xl p-5 sm:p-7">
        <p className="mb-2 text-xs uppercase tracking-wider muted">Shows</p>
        <h1 className="text-2xl font-bold sm:text-3xl">{performer.label}</h1>
        <p className="mt-1 text-sm muted">
          {shows.length.toLocaleString()} shows, {years[years.length - 1]}–
          {years[0]} · {withSetlists} with setlists
          {withUploads > 0 &&
            ` · ${withUploads} with photos or recordings`}
        </p>

        <nav aria-label="Jump to year" className="mt-4 flex flex-wrap gap-1.5">
          {years.map((year) => (
            <a
              key={year}
              href={`#y${year}`}
              className="chip text-xs tabular-nums"
              title={`${byYear.get(year)!.length} shows`}
            >
              {year}
            </a>
          ))}
        </nav>
      </header>

      {/* Tours read a career at a more useful altitude than a thousand
          individual nights — and a cruise or a festival is the same shape. */}
      {tours.length > 0 && (
        <section className="surface rounded-2xl p-4 sm:p-5">
          <h2 className="mb-2 text-lg font-bold">
            Tours
            <span className="ml-2 text-sm font-normal muted">
              {tours.length}
            </span>
          </h2>
          <ul className="divide-y">
            {tours.map((tour) => (
              <li key={tour.slug} style={{ borderColor: "var(--border)" }}>
                <Link
                  href={`/tour/${tour.slug}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm hover:opacity-80"
                >
                  <span className="font-medium">{tour.label}</span>
                  <span className="text-xs muted">
                    {tour.firstDate.slice(0, 4)}
                    {tour.lastDate.slice(0, 4) !== tour.firstDate.slice(0, 4) &&
                      `–${tour.lastDate.slice(0, 4)}`}{" "}
                    · {tour.showCount}{" "}
                    {tour.showCount === 1 ? "night" : "nights"} ·{" "}
                    {tour.cityCount}{" "}
                    {tour.cityCount === 1 ? "city" : "cities"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {years.map((year) => {
        const list = byYear.get(year)!;
        return (
          <section
            key={year}
            id={`y${year}`}
            className="surface scroll-mt-20 rounded-2xl p-4 sm:p-5"
          >
            <h2 className="mb-2 flex items-baseline gap-2 text-lg font-bold">
              {year}
              <span className="text-sm font-normal muted">
                {list.length} {list.length === 1 ? "show" : "shows"}
              </span>
            </h2>

            <ul className="divide-y">
              {list.map((show) => (
                <li
                  key={`${show.where.slug}|${show.eventDate}`}
                  style={{ borderColor: "var(--border)" }}
                >
                  <Link
                    href={`/m/${show.where.slug}/${show.eventDate}`}
                    className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 py-2 text-sm hover:opacity-80 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]"
                  >
                    <span className="tabular-nums muted">
                      {formatEventDate(show.eventDate).replace(/, \d{4}$/, "")}
                    </span>

                    <span className="min-w-0">
                      <span
                        className="font-medium"
                        style={{ borderBottom: `2px solid ${FACET_COLOR.where}33` }}
                      >
                        {show.where.label}
                      </span>
                      {show.tour && (
                        <span className="block truncate text-xs muted">
                          {show.tour}
                        </span>
                      )}
                    </span>

                    <span className="col-start-2 flex gap-3 text-xs muted sm:col-start-auto sm:justify-end">
                      {show.songCount > 0 && <span>{show.songCount} songs</span>}
                      {show.mediaCount > 0 && (
                        <span style={{ color: FACET_COLOR.who }}>
                          {show.mediaCount}{" "}
                          {show.mediaCount === 1 ? "upload" : "uploads"}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
