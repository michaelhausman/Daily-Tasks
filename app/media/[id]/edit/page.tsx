import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import { canEdit, groupTagsByFacet } from "@/lib/media/edit";
import { getMediaById } from "@/lib/media/queries";
import { storage } from "@/lib/storage";
import { EditForm } from "./EditForm";

export const dynamic = "force-dynamic";

export default async function EditMediaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const viewerIsAdmin = isAdmin(user?.handle);

  const item = await getMediaById(id, user?.id, viewerIsAdmin);
  if (!item) notFound();

  // 404 rather than 403, same as /admin — no reason to confirm the page exists
  // to someone who can't use it.
  if (!canEdit(user, item.ownerId)) notFound();

  const grouped = groupTagsByFacet(item.tags);
  const thumb = item.thumbKey ?? item.posterKey;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <p className="mb-1 text-xs uppercase tracking-wider muted">Editing</p>
        <h1 className="text-2xl font-bold">Change tags and details</h1>
        <p className="mt-1 text-sm muted">
          The file itself stays as it is — to replace the photo, delete this and
          upload again.
        </p>
      </header>

      <div className="surface flex items-center gap-4 rounded-xl p-3">
        <div
          className="h-16 w-16 shrink-0 overflow-hidden rounded-lg"
          style={{ background: "var(--surface-2)" }}
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={storage.url(thumb)}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl muted">
              {item.kind === "audio" ? "♪" : item.kind === "video" ? "▶" : "▣"}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm">
            {item.caption || <span className="muted">(no caption)</span>}
          </p>
          <p className="text-xs muted">
            {item.kind} by @{item.owner.handle}
            {user?.id !== item.ownerId && " — editing as moderator"}
          </p>
        </div>
      </div>

      <EditForm
        mediaId={item.id}
        initial={{
          caption: item.caption ?? "",
          eventDate: item.eventDate ?? "",
          visibility: item.visibility,
          who: grouped.who,
          where: grouped.where,
          topic: grouped.topic,
        }}
      />

      <p className="text-sm muted">
        <Link href={`/media/${item.id}`} style={{ color: "#7c5cff" }}>
          ← Back without saving
        </Link>
      </p>
    </div>
  );
}
