import Link from "next/link";

import { MediaGrid } from "@/components/MediaCard";
import { MomentGrid } from "@/components/MomentCard";
import { getCurrentUser } from "@/lib/auth/session";
import { EMPTY_SELECTION, findMedia, findMoments } from "@/lib/media/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();

  const [moments, recent] = await Promise.all([
    findMoments({ limit: 9 }),
    findMedia(EMPTY_SELECTION, { limit: 12, viewerId: user?.id }),
  ]);

  return (
    <div className="space-y-10">
      <section className="surface rounded-2xl p-6 sm:p-10">
        <h1 className="max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">
          Everyone&apos;s angle on the same moment.
        </h1>
        <p className="mt-3 max-w-2xl text-sm muted sm:text-base">
          Upload a photo, a clip, or a recording and tag it with{" "}
          <span style={{ color: "#7c5cff" }}>who</span>,{" "}
          <span style={{ color: "#0e9f6e" }}>where</span>, and{" "}
          <span style={{ color: "#f05252" }}>when</span>. Everything sharing
          those tags pools together automatically — so the video you shot from
          the back of the crowd lands next to the one somebody else shot from
          the rail.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/explore" className="btn btn-ghost">
            Browse by tag
          </Link>
          <Link href={user ? "/upload" : "/signup"} className="btn btn-primary">
            {user ? "Upload something" : "Get started"}
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-bold">Moments</h2>
          <Link href="/explore" className="text-sm muted hover:opacity-80">
            Explore all →
          </Link>
        </div>
        <p className="mb-4 text-sm muted">
          A performer, a place, and a day — pooled from everyone who was there.
        </p>
        <MomentGrid moments={moments} />
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">Recent uploads</h2>
        <MediaGrid items={recent} />
      </section>
    </div>
  );
}
