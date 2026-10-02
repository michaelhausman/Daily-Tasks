import { Suspense } from "react";

import { FollowButton } from "@/components/FollowButton";
import { MediaGrid } from "@/components/MediaCard";
import { MomentGrid } from "@/components/MomentCard";
import { getCurrentUser } from "@/lib/auth/session";
import { getTagsBySlugs } from "@/lib/tags/service";
import { isFollowingTag, likeStateFor } from "@/lib/social/service";
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

  // Picking a performer or a single place also lists its moments, including
  // known shows nobody has posted from yet — the way into an artist's history
  // before the uploads arrive. Topic and date picks narrow uploads, not shows,
  // so they fall back to uploads alone.
  const showMoments =
    !isEmpty &&
    selection.topic.length === 0 &&
    selection.dates.length === 0 &&
    selection.where.length <= 1 &&
    (selection.who.length > 0 || selection.where.length === 1);

  const moments = isEmpty
    ? await findMoments({ limit: 6 })
    : showMoments
      ? await findMoments({
          who: selection.who,
          where: selection.where[0],
          includeEmpty: true,
          orderBy: "date",
          limit: 60,
        })
      : [];
  const likes = await likeStateFor(
    results.map((r) => r.id),
    user?.id,
  );

  // Following is offered for whichever tags are currently selected — that's the
  // point at which someone has demonstrated interest in one, and it avoids
  // hanging a button off every chip in the picker.
  const selectedTags = await getTagsBySlugs([
    ...selection.who.map((slug) => ({ facet: "who" as const, slug })),
    ...selection.where.map((slug) => ({ facet: "where" as const, slug })),
    ...selection.topic.map((slug) => ({ facet: "topic" as const, slug })),
  ]);

  const followState = new Map<string, boolean>();
  if (user) {
    await Promise.all(
      selectedTags.map(async (t) => {
        followState.set(t.id, await isFollowingTag(user.id, t.id));
      }),
    );
  }

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

      {selectedTags.length > 0 && (
        <section className="surface rounded-xl p-4">
          <h2 className="mb-1 text-sm font-semibold">Keep up with these</h2>
          <p className="mb-3 text-xs muted">
            Anything new tagged this way goes to the top of your home page.
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedTags.map((t) => (
              <FollowButton
                key={t.id}
                target={{ kind: "tag", tagId: t.id }}
                initialFollowing={followState.get(t.id) ?? false}
                loggedIn={Boolean(user)}
                label={`Follow ${t.label}`}
              />
            ))}
          </div>
        </section>
      )}

      {moments.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-bold">
            {isEmpty ? "Moments" : "Shows and moments"}
          </h2>
          {!isEmpty && (
            <p className="-mt-2 mb-4 text-sm muted">
              Newest first
              {moments.length === 60 ? " — the latest 60" : ""}. Every known
              show has a page, even before anyone has posted from it.
            </p>
          )}
          <MomentGrid moments={moments} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xl font-bold">
          {isEmpty ? "Everything" : "Matching uploads"}
        </h2>
        <MediaGrid items={results} likes={likes} loggedIn={Boolean(user)} />
      </section>
    </div>
  );
}
