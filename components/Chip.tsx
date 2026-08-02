import Link from "next/link";

import type { Facet } from "@/lib/db/schema";
import { formatEventDate } from "@/lib/tags/normalize";

export type ChipFacet = Facet | "when";

export const FACET_COLOR: Record<ChipFacet, string> = {
  who: "#7c5cff",
  where: "#0e9f6e",
  when: "#f05252",
  topic: "#6b7280",
};

export const FACET_LABEL: Record<ChipFacet, string> = {
  who: "Who",
  where: "Where",
  when: "When",
  topic: "Topic",
};

/**
 * All four facets render identically. The user never needs to know that `when`
 * is a column and the rest are rows — that distinction is a storage concern.
 */
export function Chip({
  facet,
  label,
  href,
  selected = false,
  count,
  onClick,
  as = "link",
}: {
  facet: ChipFacet;
  label: string;
  href?: string;
  selected?: boolean;
  count?: number;
  onClick?: () => void;
  as?: "link" | "button" | "static";
}) {
  const color = FACET_COLOR[facet];
  const text = facet === "when" ? formatEventDate(label) : label;

  const style = selected
    ? { background: color, borderColor: "transparent", color: "#fff" }
    : { borderLeft: `3px solid ${color}` };

  const inner = (
    <>
      <span>{text}</span>
      {count !== undefined && (
        <span className="text-xs opacity-70">{count}</span>
      )}
    </>
  );

  const className = `chip ${selected ? "chip-selected" : ""}`;

  if (as === "button") {
    return (
      <button type="button" onClick={onClick} className={className} style={style}>
        {inner}
      </button>
    );
  }

  if (as === "static" || !href) {
    return (
      <span className={className} style={style}>
        {inner}
      </span>
    );
  }

  return (
    <Link href={href} className={`${className} hover:opacity-80`} style={style}>
      {inner}
    </Link>
  );
}
