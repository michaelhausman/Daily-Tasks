"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Facet } from "@/lib/db/schema";
import { slugify } from "@/lib/tags/normalize";
import { FACET_COLOR } from "./Chip";

type Suggestion = { slug: string; label: string; usageCount: number };

/** A row in the dropdown: either an existing tag, or "make a new one". */
type Option =
  | { kind: "existing"; label: string; slug: string; usageCount: number }
  | { kind: "create"; label: string };

/**
 * Typeahead over existing tags, and the single most important piece of UI in
 * the app for data quality.
 *
 * It has two jobs that pull against each other:
 *
 * 1. Steer people onto tags that already exist. Every duplicate created here
 *    ("aimee mann" next to "Aimee Mann") splits a pool in half, and the split
 *    is invisible — both uploaders see their own file and assume nobody else
 *    posted. Showing what exists, with usage counts, is what prevents that.
 *
 * 2. Make it obvious you can invent a new one. The first person to upload a
 *    David Bowie photo has no existing tag to pick, and if the dropdown simply
 *    disappears when nothing matches, the field reads as if it rejected them.
 *    So an explicit "Add …" row always appears for unmatched input.
 *
 * Job 1 is why the create row sorts *below* the matches rather than above.
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

  const trimmed = draft.trim().replace(/\s+/g, " ");

  const options = useMemo<Option[]>(() => {
    const rows: Option[] = suggestions.map((s) => ({
      kind: "existing",
      label: s.label,
      slug: s.slug,
      usageCount: s.usageCount,
    }));

    if (!trimmed) return rows;

    // Compare on the slug, not the raw text — "aimee mann" must count as
    // already matching "Aimee Mann", or we'd offer to create a duplicate that
    // the server would then silently merge, which is confusing.
    const draftSlug = slugify(trimmed);
    if (!draftSlug) return rows;

    const alreadyExists = suggestions.some((s) => s.slug === draftSlug);
    const alreadyPicked = value.some((v) => slugify(v) === draftSlug);

    if (!alreadyExists && !alreadyPicked) {
      rows.push({ kind: "create", label: trimmed });
    }

    return rows;
  }, [suggestions, trimmed, value]);

  function commit(option: Option) {
    const clean = option.label.trim().replace(/\s+/g, " ");
    if (!clean) return;
    if (value.some((v) => slugify(v) === slugify(clean))) {
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
      const picked = options[highlight];
      if (open && picked) commit(picked);
      else if (trimmed) commit({ kind: "create", label: trimmed });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      remove(value.length - 1);
    }
  }

  const color = FACET_COLOR[facet];

  return (
    <div ref={boxRef} className="relative">
      <label className="mb-1.5 block text-sm font-medium">
        <span
          className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
          style={{ background: color }}
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
            style={{ background: color }}
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
          placeholder={value.length === 0 ? placeholder : "Add another…"}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
          aria-autocomplete="list"
          aria-expanded={open && options.length > 0}
        />
      </div>

      {open && options.length > 0 && (
        <ul
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg shadow-xl"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          {options.map((option, i) => (
            <li key={option.kind === "create" ? "__create" : option.slug}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(option)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                style={{
                  background:
                    i === highlight ? "var(--surface-2)" : "transparent",
                }}
              >
                {option.kind === "existing" ? (
                  <>
                    <span>{option.label}</span>
                    <span className="shrink-0 text-xs muted">
                      {option.usageCount}{" "}
                      {option.usageCount === 1 ? "upload" : "uploads"}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <span
                        className="mr-1.5 font-semibold"
                        style={{ color }}
                      >
                        +
                      </span>
                      Add <strong>{option.label}</strong>
                    </span>
                    <span className="shrink-0 text-xs muted">new tag</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
