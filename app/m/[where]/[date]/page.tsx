import Link from "next/link";
import { notFound } from "next/navigation";

import { Chip } from "@/components/Chip";
import { Comments } from "@/components/Comments";
import { FollowButton } from "@/components/FollowButton";
import { MediaGrid } from "@/components/MediaCard";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import { findMedia, findMoments } from "@/lib/media/queries";
import {
  isFollowingMoment,
  likeStateFor,
  listComments,
} from "@/lib/social/service";
import {
  formatEventDate,
  isValidEventDate,
  isValidSlug,
} from "@/lib/tags/normalize";

export const dynamic = "force-dynamic";

export default async function MomentPage({
  params,
  searchParams,
}: {
  params: Promise<{ where: string; date: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { where, date } = await params;
  const query = await searchParams;

  if (!isValidSlug(where) || !isValidEventDate(date)) notFound();

  const user = await getCurrentUser();

  // Optional in-page narrowing to one performer. This is what replaces the old
  // performer-scoped moment URL: the pool stays whole, and you filter within it.
  const rawWho = query.who;
  const whoFilter =
    typeof rawWho === "string" && isValidSlug(rawWho) ? rawWho : null;

  const [items, moments, comments, following] = await Promise.all([
    findMedia(
      { who: whoFilter ? [whoFilter] : [], where: [where], topic: [], dates: [date] },
      { limit: 200, viewerId: user?.id },
    ),
    findMoments({ where, eventDate: date, limit: 1 }),
    listComments({ kind: "moment", whereSlug: where, eventDate: date }),
    user ? isFollowingMoment(user.id, where, date) : Promise.resolve(false),
  ]);

  const moment = moments[0];
  if (!moment && items.length === 0) notFound();

  const whereLabel = moment?.where.label ?? where;
  const performers = moment?.performers ?? [];
  const likes = await likeStateFor(
    items.map((i) => i.id),
    user?.id,
  );

  const contributors = [...new Set(items.map((i) => i.owner.handle))];
  const counts = {
    photo: items.filter((i) => i.kind === "photo").length,
    video: items.filter((i) => i.kind === "video").length,
    audio: items.filter((i) => i.kind === "audio").length,
  };

  // Performer chips need slugs for links; derive from the items on the page.
  const performerTags = new Map<string, string>();
  for (const item of items) {
    for (const t of item.tags) {
      if (t.facet === "who") performerTags.set(t.slug, t.label);
    }
  }
  for (const label of performers) {
    // Ensure performers from other filtered-out items still appear.
    if (![...performerTags.values()].includes(label)) {
      performerTags.set(
        label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        label,
      );
    }
  }

  return (
    <div className="space-y-6">
      <header className="surface rounded-2xl p-5 sm:p-7">
        <p className="mb-2 text-xs uppercase tracking-wider muted">Moment</p>

        <h1 className="text-2xl font-bold sm:text-3xl">{whereLabel}</h1>
        <p className="mt-1 text-sm muted">{formatEventDate(date)}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Chip facet="where" label={whereLabel} href={`/explore?where=${where}`} />
          <Chip facet="when" label={date} href={`/explore?date=${date}`} />
        </div>

        {performerTags.size > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs uppercase tracking-wider muted">
              Who was playing
            </p>
            <div className="flex flex-wrap gap-2">
              {[...performerTags.entries()].map(([slug, label]) => (
                <Chip
                  key={slug}
                  facet="who"
                  label={label}
                  selected={whoFilter === slug}
                  href={
                    whoFilter === slug
                      ? `/m/${where}/${date}`
                      : `/m/${where}/${date}?who=${slug}`
                  }
                />
              ))}
            </div>
            {whoFilter && (
              <p className="mt-2 text-xs muted">
                Showing only {performerTags.get(whoFilter) ?? whoFilter}.{" "}
                <Link href={`/m/${where}/${date}`} style={{ color: "#7c5cff" }}>
                  Show everything from this day
                </Link>
              </p>
            )}
          </div>
        )}

        <p className="mt-4 text-sm muted">
          {items.length} {items.length === 1 ? "upload" : "uploads"} from{" "}
          {contributors.length}{" "}
          {contributors.length === 1 ? "person" : "people"}
          {" — "}
          {[
            counts.photo && `${counts.photo} photo${counts.photo > 1 ? "s" : ""}`,
            counts.video && `${counts.video} video${counts.video > 1 ? "s" : ""}`,
            counts.audio && `${counts.audio} audio`,
          ]
            .filter(Boolean)
            .join(", ")}
        </p>

        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {contributors.map((handle) => (
            <Link
              key={handle}
              href={`/u/${handle}`}
              className="muted hover:opacity-80"
            >
              @{handle}
            </Link>
          ))}
        </div>

        <div className="mt-5">
          <FollowButton
            target={{ kind: "moment", whereSlug: where, eventDate: date }}
            initialFollowing={following}
            loggedIn={Boolean(user)}
            label="Follow this moment"
          />
          <p className="mt-1.5 text-xs muted">
            Following puts new uploads from this day at the top of your home
            page.
          </p>
        </div>
      </header>

      <MediaGrid items={items} likes={likes} loggedIn={Boolean(user)} />

      <p className="text-center text-sm muted">
        Were you there too?{" "}
        <Link href="/upload" style={{ color: "#7c5cff" }}>
          Add your photos
        </Link>
        .
      </p>

      <div className="surface rounded-2xl p-5">
        <Comments
          comments={comments}
          viewerId={user?.id}
          viewerIsAdmin={isAdmin(user?.handle)}
          loggedIn={Boolean(user)}
          whereSlug={where}
          eventDate={date}
          prompt={`What was ${whereLabel} like that day?`}
        />
      </div>
    </div>
  );
}
