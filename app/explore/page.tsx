import { Suspense } from "react";

import { MediaGrid } from "@/components/MediaCard";
import { MomentGrid } from "@/components/MomentCard";
import { getCurrentUser } from "@/lib/auth/session";
import {
  countMedia,
  findMedia,
  findMoments,
  getFacetOptions,
  selectionIsEmpty,
  type FacetSelection,
} from "@/lib/media/queries";
import { isValidEventDate, isValidSlug } from "@/lib/tags/normalize";
import { FacetPicker } from "./FacetPicker";

export const dynamic = "force-dynamic";

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string[] {
  const raw = params[key];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  // Slugs come straight off the query string and go into SQL bindings — they're
  // parameterized, but filtering to well-formed values keeps junk out of the
  // query plan and out of the rendered chip list.
  const selection: FacetSelection = {
    who: readParam(params, "who").filter(isValidSlug),
    where: readParam(params, "where").filter(isValidSlug),
    topic: readParam(params, "topic").filter(isValidSlug),
    dates: readParam(params, "date").filter(isValidEventDate),
  };

  const [options, results, total] = await Promise.all([
    getFacetOptions(),
    findMedia(selection, { limit: 60, viewerId: user?.id }),
    countMedia(selection, user?.id),
  ]);

  const isEmpty = selectionIsEmpty(selection);
  const moments = isEmpty ? await findMoments({ limit: 6 }) : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-bold">Explore</h1>
        <p className="text-sm muted">
          Pick any combination of tags. Everything that matches pools together.
        </p>
      </div>

      <section className="surface rounded-xl p-4 sm:p-5">
        <Suspense fallback={<p className="text-sm muted">Loading tags…</p>}>
          <FacetPicker
            options={options}
            selected={{
              who: selection.who,
              where: selection.where,
              topic: selection.topic,
              when: selection.dates,
            }}
            resultCount={total}
          />
        </Suspense>
      </section>

      {isEmpty && moments.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-bold">Moments</h2>
          <MomentGrid moments={moments} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xl font-bold">
          {isEmpty ? "Everything" : "Matching uploads"}
        </h2>
        <MediaGrid items={results} />
      </section>
    </div>
  );
}
