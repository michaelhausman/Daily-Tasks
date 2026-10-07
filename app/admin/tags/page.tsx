import Link from "next/link";
import { notFound } from "next/navigation";

import { FACET_COLOR } from "@/components/Chip";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import { FACETS, type Facet } from "@/lib/db/schema";
import {
  deleteTagAction,
  mergeTagsAction,
  renameTagAction,
} from "@/lib/moderation/actions";
import { findTags } from "@/lib/moderation/service";
import { TagRow } from "./TagRow";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function AdminTagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.handle)) notFound();

  const params = await searchParams;
  const query = one(params.q).trim();
  const rawFacet = one(params.facet);
  const facet = FACETS.includes(rawFacet as Facet) ? (rawFacet as Facet) : null;
  const page = Math.max(1, Number(one(params.page)) || 1);

  const { rows, total, pages, page: current } = await findTags({
    query,
    facet,
    page,
    perPage: PER_PAGE,
  });

  // Keeps the search and facet when stepping through pages.
  function pageHref(to: number): string {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (facet) next.set("facet", facet);
    if (to > 1) next.set("page", String(to));
    const qs = next.toString();
    return qs ? `/admin/tags?${qs}` : "/admin/tags";
  }

  function facetHref(to: Facet | null): string {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (to) next.set("facet", to);
    const qs = next.toString();
    return qs ? `/admin/tags?${qs}` : "/admin/tags";
  }

  const first = total === 0 ? 0 : (current - 1) * PER_PAGE + 1;
  const last = Math.min(current * PER_PAGE, total);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Tags</h1>
        <p className="mt-1 text-sm muted">
          <Link href="/admin" style={{ color: "#7c5cff" }}>
            ← Back to moderation
          </Link>{" "}
          <Link href="/admin/shows" style={{ color: "#7c5cff" }}>
            Import shows →
          </Link>
        </p>
        <p className="mt-3 max-w-2xl text-sm muted">
          A bad tag does more damage than a bad photo: it pollutes browse for
          everyone and survives deleting every upload that used it. Renaming
          fixes a typo, merging folds a duplicate into the real one, and
          deleting removes the label without touching any uploads.
        </p>
      </header>

      {/* A plain GET form, so a search is a URL you can bookmark or reload. */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        {facet && <input type="hidden" name="facet" value={facet} />}
        <input
          name="q"
          defaultValue={query}
          placeholder="Search tags — try a venue you suspect is duplicated"
          className="input text-sm"
          style={{ flex: "1 1 18rem", minWidth: 0 }}
        />
        <button type="submit" className="btn btn-primary text-sm">
          Search
        </button>
        {query && (
          <Link href={facetHref(facet)} className="text-xs muted underline">
            Clear
          </Link>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={facetHref(null)}
          className="chip text-xs"
          style={
            facet === null
              ? { borderColor: "#7c5cff", color: "#7c5cff" }
              : undefined
          }
        >
          All
        </Link>
        {FACETS.map((f) => (
          <Link
            key={f}
            href={facetHref(f)}
            className="chip text-xs"
            style={
              facet === f
                ? { borderColor: FACET_COLOR[f], color: FACET_COLOR[f] }
                : undefined
            }
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: FACET_COLOR[f] }}
            />
            {f}
          </Link>
        ))}

        <span className="flex-1" />
        <span className="text-xs muted">
          {total === 0
            ? "No matches"
            : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm muted">
          {query
            ? `Nothing matches “${query}”.`
            : "No tags yet — they appear as people upload."}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              renameAction={renameTagAction}
              mergeAction={mergeTagsAction}
              deleteAction={deleteTagAction}
            />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {current > 1 ? (
            <Link href={pageHref(current - 1)} style={{ color: "#7c5cff" }}>
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs muted">
            Page {current} of {pages}
          </span>
          {current < pages ? (
            <Link href={pageHref(current + 1)} style={{ color: "#7c5cff" }}>
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
