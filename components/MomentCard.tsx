import Link from "next/link";

import type { Moment } from "@/lib/media/queries";
import { formatEventDate } from "@/lib/tags/normalize";
import { storage } from "@/lib/storage";
import { FACET_COLOR } from "./Chip";

export function momentHref(m: {
  who: { slug: string };
  where: { slug: string };
  eventDate: string;
}) {
  return `/m/${m.who.slug}/${m.where.slug}/${m.eventDate}`;
}

export function MomentCard({ moment }: { moment: Moment }) {
  const previews = moment.previewKeys.slice(0, 4);

  return (
    <Link
      href={momentHref(moment)}
      className="surface block overflow-hidden rounded-xl transition-transform hover:-translate-y-0.5"
    >
      <div
        className="grid aspect-[16/9] w-full grid-cols-2 grid-rows-2 gap-px"
        style={{ background: "var(--border)" }}
      >
        {previews.length > 0 ? (
          previews.map((key, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${key}-${i}`}
              src={storage.url(key)}
              alt=""
              loading="lazy"
              className={`h-full w-full object-cover ${
                previews.length === 1
                  ? "col-span-2 row-span-2"
                  : previews.length === 2
                    ? "row-span-2"
                    : previews.length === 3 && i === 0
                      ? "row-span-2"
                      : ""
              }`}
              style={{ background: "var(--surface-2)" }}
            />
          ))
        ) : (
          <div
            className="col-span-2 row-span-2 flex items-center justify-center text-2xl muted"
            style={{ background: "var(--surface-2)" }}
          >
            ♪
          </div>
        )}
      </div>

      <div className="space-y-2 p-3">
        <div className="flex flex-wrap gap-1.5">
          <span
            className="chip text-xs"
            style={{ borderLeft: `3px solid ${FACET_COLOR.who}` }}
          >
            {moment.who.label}
          </span>
          <span
            className="chip text-xs"
            style={{ borderLeft: `3px solid ${FACET_COLOR.where}` }}
          >
            {moment.where.label}
          </span>
          <span
            className="chip text-xs"
            style={{ borderLeft: `3px solid ${FACET_COLOR.when}` }}
          >
            {formatEventDate(moment.eventDate)}
          </span>
        </div>

        <p className="text-xs muted">
          {moment.mediaCount} {moment.mediaCount === 1 ? "upload" : "uploads"}
          {" · "}
          {moment.contributorCount}{" "}
          {moment.contributorCount === 1 ? "person" : "people"}
        </p>
      </div>
    </Link>
  );
}

export function MomentGrid({ moments }: { moments: Moment[] }) {
  if (moments.length === 0) {
    return (
      <div className="surface rounded-xl p-10 text-center">
        <p className="muted">
          No moments yet. A moment appears when uploads share a performer, a
          place, and a date.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {moments.map((m) => (
        <MomentCard key={momentHref(m)} moment={m} />
      ))}
    </div>
  );
}
