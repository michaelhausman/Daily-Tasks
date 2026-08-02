"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { Chip, type ChipFacet } from "@/components/Chip";
import type { Tag } from "@/lib/db/schema";

type Options = {
  who: Tag[];
  where: Tag[];
  topic: Tag[];
  dates: Array<{ date: string; count: number }>;
};

const PARAM_BY_FACET: Record<ChipFacet, string> = {
  who: "who",
  where: "where",
  topic: "topic",
  when: "date",
};

export function FacetPicker({
  options,
  selected,
  resultCount,
}: {
  options: Options;
  selected: Record<ChipFacet, string[]>;
  resultCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const toggle = useCallback(
    (facet: ChipFacet, slug: string) => {
      const param = PARAM_BY_FACET[facet];
      const next = new URLSearchParams(searchParams.toString());
      const current = next.getAll(param);

      next.delete(param);
      const updated = current.includes(slug)
        ? current.filter((v) => v !== slug)
        : [...current, slug];

      for (const value of updated) next.append(param, value);

      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const anySelected = Object.values(selected).some((v) => v.length > 0);

  const groups: Array<{
    facet: ChipFacet;
    title: string;
    hint: string;
    items: Array<{ slug: string; label: string; count: number }>;
  }> = [
    {
      facet: "who",
      title: "Who",
      hint: "performer, artist, team, person",
      items: options.who.map((t) => ({
        slug: t.slug,
        label: t.label,
        count: t.usageCount,
      })),
    },
    {
      facet: "where",
      title: "Where",
      hint: "venue, festival, city",
      items: options.where.map((t) => ({
        slug: t.slug,
        label: t.label,
        count: t.usageCount,
      })),
    },
    {
      facet: "when",
      title: "When",
      hint: "the day it happened",
      items: options.dates.map((d) => ({
        slug: d.date,
        label: d.date,
        count: d.count,
      })),
    },
    {
      facet: "topic",
      title: "Topic",
      hint: "anything else",
      items: options.topic.map((t) => ({
        slug: t.slug,
        label: t.label,
        count: t.usageCount,
      })),
    },
  ];

  return (
    <div className="space-y-5">
      {groups
        .filter((g) => g.items.length > 0)
        .map((group) => (
          <div key={group.facet}>
            <h3 className="mb-2 text-sm font-semibold">
              {group.title}{" "}
              <span className="font-normal muted">— {group.hint}</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {group.items.map((item) => (
                <Chip
                  key={item.slug}
                  facet={group.facet}
                  label={item.label}
                  count={item.count}
                  selected={selected[group.facet].includes(item.slug)}
                  as="button"
                  onClick={() => toggle(group.facet, item.slug)}
                />
              ))}
            </div>
          </div>
        ))}

      <div
        className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="muted">
          {resultCount} {resultCount === 1 ? "upload" : "uploads"} match
        </span>
        {anySelected && (
          <button
            type="button"
            onClick={() => router.push(pathname, { scroll: false })}
            className="muted underline hover:opacity-80"
          >
            Clear all
          </button>
        )}
        <span className="ml-auto text-xs muted">
          Multiple picks in one group widen the search; picks across groups
          narrow it.
        </span>
      </div>
    </div>
  );
}
