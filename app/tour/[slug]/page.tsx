import Link from "next/link";
import { notFound } from "next/navigation";

import { Chip, FACET_COLOR } from "@/components/Chip";
import { findTour } from "@/lib/shows/tours";
import { formatEventDate, isValidSlug } from "@/lib/tags/normalize";

export const dynamic = "force-dynamic";

/**
 * A tour, festival or cruise — the level above a moment.
 *
 * A moment is one event: one place, one day. That is the right unit for a
 * concert and too small for the thing a week on a boat or a summer on the
 * road actually is. This page is that thing: every moment it contains, in the
 * order it happened, with the ones people have posted to marked.
 *
 * Nothing here is created by hand. A tour exists because imported shows name
 * it, which is why "JoCo Cruise Crazy 2011" has a page without anyone having
 * decided that cruises are a feature.
 */
export default async function TourPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();

  const tour = await findTour(slug);
  if (!tour) notFound();

  const sameYear = tour.firstDate.slice(0, 4) === tour.lastDate.slice(0, 4);
  const posted = tour.moments.filter((m) => m.mediaCount > 0).length;

  // Grouped by year only when it spans more than one, so a three-week tour
  // isn't broken up by a heading that says nothing.
  const years = [...new Set(tour.moments.map((m) => m.eventDate.slice(0, 4)))];

  return (
    <div className="space-y-6">
      <header className="surface rounded-2xl p-5 sm:p-7">
        <p className="mb-2 text-xs uppercase tracking-wider muted">Tour</p>
        <h1 className="text-2xl font-bold sm:text-3xl">{tour.label}</h1>

        <p className="mt-1 text-sm muted">
          {formatEventDate(tour.firstDate)} – {formatEventDate(tour.lastDate)} ·{" "}
          {tour.moments.length} {tour.moments.length === 1 ? "night" : "nights"}{" "}
          · {tour.cityCount} {tour.cityCount === 1 ? "city" : "cities"}
          {posted > 0 && ` · ${posted} with photos`}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {tour.performers.map((performer) => (
            <Chip
              key={performer.slug}
              facet="who"
              label={performer.label}
              href={`/explore?who=${performer.slug}`}
            />
          ))}
        </div>

        {tour.mediaCount === 0 && (
          <p className="mt-4 text-sm muted">
            Nobody has posted from this one yet. Every night below has a page
            waiting — if you were at any of them, that&rsquo;s where it goes.
          </p>
        )}
      </header>

      {years.map((year) => {
        const list = tour.moments.filter((m) => m.eventDate.startsWith(year));
        return (
          <section key={year} className="surface rounded-2xl p-4 sm:p-5">
            {!sameYear && (
              <h2 className="mb-2 flex items-baseline gap-2 text-lg font-bold">
                {year}
                <span className="text-sm font-normal muted">
                  {list.length} {list.length === 1 ? "night" : "nights"}
                </span>
              </h2>
            )}

            <ul className="divide-y">
              {list.map((moment) => (
                <li
                  key={`${moment.whereSlug}|${moment.eventDate}`}
                  style={{ borderColor: "var(--border)" }}
                >
                  <Link
                    href={`/m/${moment.whereSlug}/${moment.eventDate}`}
                    className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 py-2 text-sm hover:opacity-80 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto]"
                  >
                    <span className="tabular-nums muted">
                      {formatEventDate(moment.eventDate).replace(/, \d{4}$/, "")}
                    </span>

                    <span className="min-w-0">
                      <span
                        className="font-medium"
                        style={{
                          borderBottom: `2px solid ${FACET_COLOR.where}33`,
                        }}
                      >
                        {moment.whereLabel}
                      </span>
                      {tour.performers.length > 1 && (
                        <span className="block truncate text-xs muted">
                          {moment.performers.join(", ")}
                        </span>
                      )}
                    </span>

                    <span className="col-start-2 text-xs sm:col-start-auto sm:justify-self-end">
                      {moment.mediaCount > 0 ? (
                        <span style={{ color: FACET_COLOR.who }}>
                          {moment.mediaCount}{" "}
                          {moment.mediaCount === 1 ? "upload" : "uploads"}
                        </span>
                      ) : (
                        <span className="muted">—</span>
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
