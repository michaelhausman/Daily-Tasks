import Link from "next/link";
import { notFound } from "next/navigation";

import { AudioPlayer } from "@/components/AudioPlayer";
import { Chip } from "@/components/Chip";
import { Comments } from "@/components/Comments";
import { LikeButton } from "@/components/LikeButton";
import { MediaGrid } from "@/components/MediaCard";
import { ReportButton } from "@/components/ReportButton";
import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import { canDelete } from "@/lib/media/delete";
import { findMedia, getMediaById } from "@/lib/media/queries";
import { likeStateFor, listComments } from "@/lib/social/service";
import { DeleteButton } from "./DeleteButton";
import { storage } from "@/lib/storage";
import { formatEventDate } from "@/lib/tags/normalize";

export const dynamic = "force-dynamic";

export default async function MediaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();

  const viewerIsAdmin = isAdmin(user?.handle);
  const item = await getMediaById(id, user?.id, viewerIsAdmin);
  if (!item) notFound();

  const whoTags = item.tags.filter((t) => t.facet === "who");
  const whereTags = item.tags.filter((t) => t.facet === "where");
  const topicTags = item.tags.filter((t) => t.facet === "topic");

  // A place and a date are all a moment needs, so most uploads have one — which
  // is the whole reason someone bothered tagging carefully.
  const moment =
    whereTags[0] && item.eventDate
      ? `/m/${whereTags[0].slug}/${item.eventDate}`
      : null;

  const siblings = moment
    ? (
        await findMedia(
          {
            who: [],
            where: [whereTags[0].slug],
            topic: [],
            dates: [item.eventDate!],
          },
          { limit: 12, viewerId: user?.id },
        )
      ).filter((m) => m.id !== item.id)
    : [];

  const [likes, comments] = await Promise.all([
    likeStateFor([item.id, ...siblings.map((s) => s.id)], user?.id),
    listComments({ kind: "media", mediaId: item.id }),
  ]);
  const own = likes.get(item.id) ?? { count: 0, liked: false };

  const fileUrl = storage.url(item.storageKey);

  return (
    <div className="space-y-6">
      {item.hiddenAt && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: "#f0525218",
            border: "1px solid #f05252",
          }}
        >
          <strong style={{ color: "#f05252" }}>
            This upload is hidden and only you can see it.
          </strong>
          <p className="mt-1 muted">
            Reason: {item.hiddenReason ?? "no reason recorded"}. It won&apos;t
            appear in browse, moments, or anyone else&apos;s feed. See the{" "}
            <Link href="/rules" style={{ color: "#7c5cff" }}>
              house rules
            </Link>
            .
          </p>
        </div>
      )}

      <div className="surface overflow-hidden rounded-2xl">
        {item.kind === "photo" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={storage.url(item.webKey ?? item.storageKey)}
            alt={item.caption ?? `Photo by @${item.owner.handle}`}
            className="max-h-[75vh] w-full object-contain"
            style={{ background: "var(--surface-2)" }}
          />
        )}

        {item.kind === "video" && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={fileUrl}
            poster={item.posterKey ? storage.url(item.posterKey) : undefined}
            controls
            playsInline
            preload="metadata"
            className="max-h-[75vh] w-full"
            style={{ background: "#000" }}
          />
        )}

        {item.kind === "audio" && (
          <AudioPlayer
            src={fileUrl}
            peaks={
              item.waveformJson
                ? (JSON.parse(item.waveformJson) as number[])
                : null
            }
          />
        )}
      </div>

      <div className="space-y-4">
        {item.caption && <p className="text-lg">{item.caption}</p>}

        <div className="flex flex-wrap gap-2">
          {whoTags.map((t) => (
            <Chip
              key={t.id}
              facet="who"
              label={t.label}
              href={`/explore?who=${t.slug}`}
            />
          ))}
          {whereTags.map((t) => (
            <Chip
              key={t.id}
              facet="where"
              label={t.label}
              href={`/explore?where=${t.slug}`}
            />
          ))}
          {item.eventDate && (
            <Chip
              facet="when"
              label={item.eventDate}
              href={`/explore?date=${item.eventDate}`}
            />
          )}
          {topicTags.map((t) => (
            <Chip
              key={t.id}
              facet="topic"
              label={t.label}
              href={`/explore?topic=${t.slug}`}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <LikeButton
            mediaId={item.id}
            initialCount={own.count}
            initialLiked={own.liked}
            loggedIn={Boolean(user)}
            size="lg"
          />
          <p className="text-sm muted">
            Uploaded by{" "}
            <Link href={`/u/${item.owner.handle}`} style={{ color: "#7c5cff" }}>
              @{item.owner.handle}
            </Link>
            {item.eventDate && ` · ${formatEventDate(item.eventDate)}`}
            {item.visibility === "unlisted" && " · unlisted"}
          </p>
        </div>

        {moment && (
          <Link href={moment} className="btn btn-ghost">
            See everyone&apos;s uploads from this moment →
          </Link>
        )}

        <div
          className="flex flex-wrap items-start gap-4 border-t pt-4"
          style={{ borderColor: "var(--border)" }}
        >
          {canDelete(user, item.ownerId) && (
            <DeleteButton mediaId={item.id} isOwn={user?.id === item.ownerId} />
          )}
          <div className="flex-1">
            <ReportButton mediaId={item.id} loggedIn={Boolean(user)} />
          </div>
        </div>
      </div>

      <div className="surface rounded-2xl p-5">
        <Comments
          comments={comments}
          viewerId={user?.id}
          viewerIsAdmin={isAdmin(user?.handle)}
          loggedIn={Boolean(user)}
          mediaId={item.id}
          prompt="Add a comment…"
        />
      </div>

      {siblings.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">Also from this moment</h2>
          <MediaGrid
            items={siblings}
            likes={likes}
            loggedIn={Boolean(user)}
          />
        </section>
      )}
    </div>
  );
}
