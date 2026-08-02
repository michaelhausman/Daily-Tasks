import Link from "next/link";
import { notFound } from "next/navigation";

import { AudioPlayer } from "@/components/AudioPlayer";
import { Chip } from "@/components/Chip";
import { MediaGrid } from "@/components/MediaCard";
import { momentHref } from "@/components/MomentCard";
import { getCurrentUser } from "@/lib/auth/session";
import { canDelete } from "@/lib/media/delete";
import { findMedia, getMediaById } from "@/lib/media/queries";
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

  const item = await getMediaById(id, user?.id);
  if (!item) notFound();

  const whoTags = item.tags.filter((t) => t.facet === "who");
  const whereTags = item.tags.filter((t) => t.facet === "where");
  const topicTags = item.tags.filter((t) => t.facet === "topic");

  // If this upload belongs to a fully-specified moment, offer the pooled view —
  // that link is the whole reason someone tagged carefully in the first place.
  const moment =
    whoTags[0] && whereTags[0] && item.eventDate
      ? momentHref({
          who: { slug: whoTags[0].slug },
          where: { slug: whereTags[0].slug },
          eventDate: item.eventDate,
        })
      : null;

  const siblings = moment
    ? (
        await findMedia(
          {
            who: [whoTags[0].slug],
            where: [whereTags[0].slug],
            topic: [],
            dates: [item.eventDate!],
          },
          { limit: 12, viewerId: user?.id },
        )
      ).filter((m) => m.id !== item.id)
    : [];

  const fileUrl = storage.url(item.storageKey);

  return (
    <div className="space-y-6">
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

        <p className="text-sm muted">
          Uploaded by{" "}
          <Link href={`/u/${item.owner.handle}`} style={{ color: "#7c5cff" }}>
            @{item.owner.handle}
          </Link>
          {item.eventDate && ` · ${formatEventDate(item.eventDate)}`}
          {item.visibility === "unlisted" && " · unlisted"}
        </p>

        {moment && (
          <Link href={moment} className="btn btn-ghost">
            See everyone&apos;s uploads from this moment →
          </Link>
        )}

        {canDelete(user, item.ownerId) && (
          <div
            className="border-t pt-4"
            style={{ borderColor: "var(--border)" }}
          >
            <DeleteButton mediaId={item.id} isOwn={user?.id === item.ownerId} />
          </div>
        )}
      </div>

      {siblings.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">Also from this moment</h2>
          <MediaGrid items={siblings} />
        </section>
      )}
    </div>
  );
}
