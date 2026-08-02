import { notFound } from "next/navigation";

import { MediaGrid } from "@/components/MediaCard";
import { getCurrentUser } from "@/lib/auth/session";
import { findMediaByOwner, getUserByHandle } from "@/lib/media/queries";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const viewer = await getCurrentUser();

  const profile = await getUserByHandle(handle.toLowerCase());
  if (!profile) notFound();

  const items = await findMediaByOwner(profile.id, viewer?.id);
  const isSelf = viewer?.id === profile.id;

  return (
    <div className="space-y-6">
      <header className="surface rounded-2xl p-5 sm:p-7">
        <h1 className="text-2xl font-bold">{profile.displayName}</h1>
        <p className="text-sm muted">@{profile.handle}</p>
        <p className="mt-3 text-sm muted">
          {items.length} {items.length === 1 ? "upload" : "uploads"}
          {isSelf && " — including your unlisted ones"}
        </p>
      </header>

      <MediaGrid items={items} />
    </div>
  );
}
