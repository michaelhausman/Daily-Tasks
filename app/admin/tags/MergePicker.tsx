"use client";

import { useEffect, useRef, useState } from "react";

import type { Facet } from "@/lib/db/schema";

type Suggestion = {
  slug: string;
  label: string;
  usageCount: number;
  showCount: number;
};

/**
 * Choose the tag a duplicate should be folded into.
 *
 * A dropdown of every tag in the facet was the obvious thing and became the
 * page's undoing — rendered once per row, it is quadratic, and a few hundred
 * venues turn the page into tens of megabytes. Fetching matches as you type
 * costs one small request instead, and is easier to use besides: with seven
 * hundred places, scrolling to find one was never realistic.
 *
 * Submits the slug rather than the row id, so the public suggestion endpoint
 * doesn't have to hand out internal ids.
 */
export function MergePicker({ facet }: { facet: Facet }) {
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [matches, setMatches] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (picked || !draft.trim()) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/tags/suggest?facet=${facet}&q=${encodeURIComponent(draft)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { tags: Suggestion[] };
        if (!cancelled) setMatches(data.tags);
      } catch {
        // Typing still works; the admin can retry.
      }
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [draft, facet, picked]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  if (picked) {
    return (
      <span className="inline-flex items-center gap-2">
        <input type="hidden" name="intoSlug" value={picked.slug} />
        <span className="text-sm font-medium">{picked.label}</span>
        <button
          type="button"
          onClick={() => {
            setPicked(null);
            setDraft("");
          }}
          className="text-xs muted underline"
        >
          change
        </button>
      </span>
    );
  }

  return (
    <span ref={boxRef} className="relative inline-block">
      <input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Start typing the surviving tag…"
        className="input text-sm"
        style={{ width: "16rem" }}
        aria-label="Surviving tag"
      />

      {open && matches.length > 0 && (
        <ul
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg shadow-xl"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          {matches.map((match) => (
            <li key={match.slug}>
              <button
                type="button"
                onClick={() => {
                  setPicked(match);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:opacity-80"
              >
                <span>{match.label}</span>
                <span className="shrink-0 text-xs muted">
                  {match.showCount > 0
                    ? `${match.showCount} shows`
                    : `${match.usageCount} uploads`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
