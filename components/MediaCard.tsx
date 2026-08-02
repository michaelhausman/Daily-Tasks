import Link from "next/link";

import { LikeButton } from "@/components/LikeButton";
import type { MediaWithTags } from "@/lib/media/queries";
import { storage } from "@/lib/storage";

function KindBadge({ kind }: { kind: string }) {
  const icon = kind === "video" ? "▶" : kind === "audio" ? "♪" : "▣";
  return (
    <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white backdrop-blur">
      {icon}
    </span>
  );
}

function formatDuration(ms: number | null): string | null {
  if (!ms) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type LikeState = { count: number; liked: boolean };

export function MediaCard({
  item,
  like,
  loggedIn = false,
}: {
  item: MediaWithTags;
  like?: LikeState;
  loggedIn?: boolean;
}) {
  const thumb = item.thumbKey ?? item.posterKey;
  const duration = formatDuration(item.durationMs);

  return (
    <div className="surface group relative overflow-hidden rounded-xl transition-transform hover:-translate-y-0.5">
      <Link href={`/media/${item.id}`} className="block">
      <div
        className="relative aspect-square w-full overflow-hidden"
        style={{ background: "var(--surface-2)" }}
      >
        {thumb ? (
          // Plain <img>: files are served by our own handler, and Next's
          // optimizer would add a second decode pass over already-derived WebP.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={storage.url(thumb)}
            alt={item.caption ?? `${item.kind} by @${item.owner.handle}`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl muted">
            {item.kind === "audio" ? "♪" : item.kind === "video" ? "▶" : "▣"}
          </div>
        )}

        <KindBadge kind={item.kind} />

        {duration && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white backdrop-blur">
            {duration}
          </span>
        )}

        {item.visibility === "unlisted" && (
          <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white backdrop-blur">
            unlisted
          </span>
        )}
      </div>

        <div className="p-2.5 pb-1.5">
          {item.caption && (
            <p className="mb-1 line-clamp-2 text-sm">{item.caption}</p>
          )}
          <p className="text-xs muted">@{item.owner.handle}</p>
        </div>
      </Link>

      {/* Outside the Link: a like must not navigate. */}
      {like && (
        <div className="px-2.5 pb-2.5">
          <LikeButton
            mediaId={item.id}
            initialCount={like.count}
            initialLiked={like.liked}
            loggedIn={loggedIn}
          />
        </div>
      )}
    </div>
  );
}

export function MediaGrid({
  items,
  likes,
  loggedIn = false,
}: {
  items: MediaWithTags[];
  likes?: Map<string, LikeState>;
  loggedIn?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="surface rounded-xl p-10 text-center">
        <p className="muted">Nothing here yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          like={likes?.get(item.id)}
          loggedIn={loggedIn}
        />
      ))}
    </div>
  );
}
