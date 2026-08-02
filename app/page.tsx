import Link from "next/link";

import { Chip } from "@/components/Chip";
import { MediaGrid } from "@/components/MediaCard";
import { MomentGrid } from "@/components/MomentCard";
import { getCurrentUser } from "@/lib/auth/session";
import {
  EMPTY_SELECTION,
  findMedia,
  findMoments,
  getMediaByIds,
} from "@/lib/media/queries";
import {
  countMomentComments,
  followedMomentKeys,
  followedTags,
  likeStateFor,
  mediaFromFollowedTags,
} from "@/lib/social/service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();

  const [moments, recent] = await Promise.all([
    findMoments({ limit: 9 }),
    findMedia(EMPTY_SELECTION, { limit: 12, viewerId: user?.id }),
  ]);

  // ── the following feed ────────────────────────────────────────────────────
  // The reason to follow anything is that logging in shows you your places and
  // your artists first, instead of whatever the whole site posted most recently.
  const [myTags, myMomentKeys] = user
    ? await Promise.all([followedTags(user.id), followedMomentKeys(user.id)])
    : [[], []];

  const [followedMoments, followedMediaIds] = user
    ? await Promise.all([
        myMomentKeys.length > 0
          ? findMoments({ keys: myMomentKeys, limit: 6 })
          : Promise.resolve([]),
        myTags.length > 0
          ? mediaFromFollowedTags(user.id, 8)
          : Promise.resolve([]),
      ])
    : [[], []];

  const followedMedia = await getMediaByIds(followedMediaIds, user?.id);

  const commentCounts = await countMomentComments([
    ...moments.map((m) => ({
      whereSlug: m.where.slug,
      eventDate: m.eventDate,
    })),
    ...followedMoments.map((m) => ({
      whereSlug: m.where.slug,
      eventDate: m.eventDate,
    })),
  ]);

  const likes = await likeStateFor(
    [...recent, ...followedMedia].map((m) => m.id),
    user?.id,
  );

  const followingAnything = myTags.length > 0 || myMomentKeys.length > 0;

  return (
    <div className="space-y-10">
      {!user && (
        <section className="surface rounded-2xl p-6 sm:p-10">
          <h1 className="max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
            Everyone&apos;s angle on the same moment.
          </h1>
          <p className="mt-3 max-w-2xl text-sm muted sm:text-base">
            Upload a photo, a clip, or a recording and tag it with{" "}
            <span style={{ color: "#0e9f6e" }}>where</span> and{" "}
            <span style={{ color: "#f05252" }}>when</span>. Everything from that
            place on that day pools together automatically — so your photo of
            CBGB lands next to everyone else&apos;s from the same night.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/explore" className="btn btn-ghost">
              Browse by tag
            </Link>
            <Link href="/signup" className="btn btn-primary">
              Get started
            </Link>
          </div>
        </section>
      )}

      {user && followingAnything && (
        <section>
          <h2 className="mb-1 text-xl font-bold">Following</h2>
          <p className="mb-4 text-sm muted">
            The places, days, and people you keep up with.
          </p>

          {myTags.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-2">
              {myTags.map((t) => (
                <Chip
                  key={t.id}
                  facet={t.facet}
                  label={t.label}
                  count={t.usageCount}
                  href={`/explore?${t.facet}=${t.slug}`}
                />
              ))}
            </div>
          )}

          {followedMoments.length > 0 && (
            <div className="mb-6">
              <MomentGrid
                moments={followedMoments}
                commentCounts={commentCounts}
              />
            </div>
          )}

          {followedMedia.length > 0 && (
            <>
              <h3 className="mb-3 text-sm font-semibold muted">
                New from tags you follow
              </h3>
              <MediaGrid
                items={followedMedia}
                likes={likes}
                loggedIn
              />
            </>
          )}

          {followedMoments.length === 0 && followedMedia.length === 0 && (
            <div className="surface rounded-xl p-8 text-center">
              <p className="muted">
                Nothing new from what you follow yet. It&apos;ll show up here.
              </p>
            </div>
          )}
        </section>
      )}

      {user && !followingAnything && (
        <section className="surface rounded-2xl p-6">
          <h2 className="text-xl font-bold">Welcome back</h2>
          <p className="mt-2 max-w-2xl text-sm muted">
            Follow a venue, an artist, or a particular day and it&apos;ll appear
            here first whenever someone adds to it. Look for the{" "}
            <strong>Follow</strong> button on any moment or tag.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/explore" className="btn btn-ghost">
              Find something to follow
            </Link>
            <Link href="/upload" className="btn btn-primary">
              Upload something
            </Link>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-bold">Moments</h2>
          <Link href="/explore" className="text-sm muted hover:opacity-80">
            Explore all →
          </Link>
        </div>
        <p className="mb-4 text-sm muted">
          A place and a day, pooled from everyone who was there.
        </p>
        <MomentGrid moments={moments} commentCounts={commentCounts} />
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">Recent uploads</h2>
        <MediaGrid
          items={recent}
          likes={likes}
          loggedIn={Boolean(user)}
        />
      </section>
    </div>
  );
}
