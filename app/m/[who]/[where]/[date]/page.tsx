import Link from "next/link";
import { notFound } from "next/navigation";

import { Chip } from "@/components/Chip";
import { MediaGrid } from "@/components/MediaCard";
import { getCurrentUser } from "@/lib/auth/session";
import { findMedia, findMoments } from "@/lib/media/queries";
import { formatEventDate, isValidEventDate, isValidSlug } from "@/lib/tags/normalize";

export const dynamic = "force-dynamic";

export default async function MomentPage({
  params,
}: {
  params: Promise<{ who: string; where: string; date: string }>;
}) {
  const { who, where, date } = await params;

  if (!isValidSlug(who) || !isValidSlug(where) || !isValidEventDate(date)) {
    notFound();
  }

  const user = await getCurrentUser();

  const [items, moments] = await Promise.all([
    findMedia(
      { who: [who], where: [where], topic: [], dates: [date] },
      { limit: 200, viewerId: user?.id },
    ),
    findMoments({ who, where, eventDate: date, limit: 1 }),
  ]);

  if (items.length === 0) notFound();

  const moment = moments[0];
  const whoLabel = moment?.who.label ?? who;
  const whereLabel = moment?.where.label ?? where;

  const contributors = [...new Set(items.map((i) => i.owner.handle))];
  const counts = {
    photo: items.filter((i) => i.kind === "photo").length,
    video: items.filter((i) => i.kind === "video").length,
    audio: items.filter((i) => i.kind === "audio").length,
  };

  return (
    <div className="space-y-6">
      <header className="surface rounded-2xl p-5 sm:p-7">
        <p className="mb-2 text-xs uppercase tracking-wider muted">Moment</p>

        <h1 className="text-2xl font-bold sm:text-3xl">
          {whoLabel} · {whereLabel}
        </h1>
        <p className="mt-1 text-sm muted">{formatEventDate(date)}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Chip facet="who" label={whoLabel} href={`/explore?who=${who}`} />
          <Chip
            facet="where"
            label={whereLabel}
            href={`/explore?where=${where}`}
          />
          <Chip facet="when" label={date} href={`/explore?date=${date}`} />
        </div>

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
      </header>

      <MediaGrid items={items} />

      <p className="text-center text-sm muted">
        Were you there too?{" "}
        <Link href="/upload" style={{ color: "#7c5cff" }}>
          Add your angle
        </Link>
        .
      </p>
    </div>
  );
}
