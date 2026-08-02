"use client";

import { useEffect, useRef, useState } from "react";

import type { Facet } from "@/lib/db/schema";
import { FACET_COLOR } from "./Chip";

type Suggestion = { slug: string; label: string; usageCount: number };

/**
 * Typeahead over existing tags, and the single most important piece of UI in
 * the app for data quality.
 *
 * Every duplicate tag that gets created here ("aimee mann" next to the existing
 * "Aimee Mann") splits a pool in half, and the split is invisible — both
 * uploaders see their own file and conclude nobody else posted. Showing what
 * already exists, with usage counts, while they type is what prevents that.
 * Normalization in lib/tags/normalize.ts is the safety net underneath.
 */
export function TagInput({
  facet,
  label,
  placeholder,
  value,
  onChange,
}: {
  facet: Facet;
  label: string;
  placeholder: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/tags/suggest?facet=${facet}&q=${encodeURIComponent(draft)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { tags: Suggestion[] };
        if (cancelled) return;
        setSuggestions(data.tags.filter((t) => !value.includes(t.label)));
        setHighlight(0);
      } catch {
        // Suggestions are a convenience; a failed fetch must not block typing.
      }
    }, 140);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [draft, facet, value]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function add(label: string) {
    const clean = label.trim().replace(/\s+/g, " ");
    if (!clean) return;
    // Case-insensitive dedupe within the form itself.
    if (value.some((v) => v.toLowerCase() === clean.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, clean]);
    setDraft("");
    setOpen(false);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (open && suggestions[highlight]) {
        add(suggestions[highlight].label);
      } else {
        add(draft);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      remove(value.length - 1);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label className="mb-1.5 block text-sm font-medium">
        <span
          className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
          style={{ background: FACET_COLOR[facet] }}
        />
        {label}
      </label>

      <div
        className="flex flex-wrap gap-1.5 rounded-lg p-2"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
      >
        {value.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-white"
            style={{ background: FACET_COLOR[facet] }}
          >
            {v}
            <button
              type="button"
              onClick={() => remove(i)}
              className="opacity-70 hover:opacity-100"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}

        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
        />
      </div>

      {open && suggestions.length > 0 && (
        <ul
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg shadow-xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          {suggestions.map((s, i) => (
            <li key={s.slug}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => add(s.label)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                style={{
                  background:
                    i === highlight ? "var(--surface-2)" : "transparent",
                }}
              >
                <span>{s.label}</span>
                <span className="text-xs muted">
                  {s.usageCount} {s.usageCount === 1 ? "upload" : "uploads"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
