"use client";

import { useEffect, useState } from "react";

import { FACET_COLOR } from "@/components/Chip";
import { formatEventDate } from "@/lib/tags/normalize";

export type PickedShow = {
  performer: string;
  where: string;
  eventDate: string;
};

type ShowMatch = {
  id: string;
  eventDate: string;
  performer: { slug: string; label: string };
  where: { slug: string; label: string };
  city: string | null;
  region: string | null;
  tour: string | null;
  mediaCount: number;
};

/**
 * "Which show were you at?" — the fastest correct way to tag a concert photo.
 *
 * Typing a venue is where a curated place list goes wrong: people write
 * "Wilbur Theater" for "The Wilbur Theatre, Boston" and a sibling tag appears
 * that splits the pool invisibly. Picking a show can't go wrong, because the
 * place and the date come from the imported row rather than from the keyboard.
 *
 * The date does nearly all the work. A photo carries its own date, so by the
 * time someone has chosen a file this is usually already showing the two or
 * three shows that happened anywhere that night — one of which is theirs.
 */
export function ShowPicker({
  eventDate,
  onPick,
  picked,
  onClear,
}: {
  eventDate: string;
  onPick: (show: PickedShow) => void;
  picked: PickedShow | null;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [useDate, setUseDate] = useState(true);
  const [matches, setMatches] = useState<ShowMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const dateFilter = useDate ? eventDate : "";

  useEffect(() => {
    if (picked) return;
    if (!query.trim() && !dateFilter) {
      setMatches([]);
      setSearched(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (dateFilter) params.set("date", dateFilter);
        const res = await fetch(`/api/shows/search?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as { shows: ShowMatch[] };
        if (cancelled) return;
        setMatches(data.shows);
        setSearched(true);
      } catch {
        // The picker is a shortcut; the tag fields below still work.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, dateFilter, picked]);

  if (picked) {
    return (
      <div
        className="rounded-xl p-3"
        style={{ background: "var(--surface-2)", border: `1px solid ${FACET_COLOR.where}55` }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{picked.performer}</p>
            <p className="text-xs muted">
              {picked.where} · {formatEventDate(picked.eventDate)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="btn text-xs"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            Change
          </button>
        </div>
        <p className="mt-2 text-xs muted">
          Tagged for this show, so it pools with everyone else who was there.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <label className="mb-1.5 block text-sm font-medium">
        Were you at a show?
      </label>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Artist, venue, or city"
        className="input text-sm"
      />

      {eventDate && (
        <p className="mt-1.5 text-xs muted">
          {useDate ? (
            <>
              Shows on {formatEventDate(eventDate)}.{" "}
              <button
                type="button"
                onClick={() => setUseDate(false)}
                style={{ color: "#7c5cff" }}
              >
                Search every date
              </button>
            </>
          ) : (
            <>
              Searching every date.{" "}
              <button
                type="button"
                onClick={() => setUseDate(true)}
                style={{ color: "#7c5cff" }}
              >
                Only {formatEventDate(eventDate)}
              </button>
            </>
          )}
        </p>
      )}

      {matches.length > 0 && (
        <ul className="mt-2 space-y-1">
          {matches.map((show) => (
            <li key={show.id}>
              <button
                type="button"
                onClick={() =>
                  onPick({
                    performer: show.performer.label,
                    where: show.where.label,
                    eventDate: show.eventDate,
                  })
                }
                className="w-full rounded-lg px-2.5 py-2 text-left text-sm hover:opacity-80"
                style={{ background: "var(--surface)" }}
              >
                <span className="font-medium">{show.performer.label}</span>
                <span className="block text-xs muted">
                  {show.where.label}
                  {!useDate && ` · ${formatEventDate(show.eventDate)}`}
                  {show.mediaCount > 0 &&
                    ` · ${show.mediaCount} already posted`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && searched && matches.length === 0 && (
        <p className="mt-2 text-xs muted">
          No show on file for that. Fill in the tags below instead — not every
          moment is a concert.
        </p>
      )}

      {matches.length > 0 && (
        <p className="mt-2 text-xs muted">
          Not listed? Fill in the tags below instead.
        </p>
      )}
    </div>
  );
}
