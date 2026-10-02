import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { cleanLabel, isValidEventDate } from "@/lib/tags/normalize";
import { UploadForm, type UploadPrefill } from "./UploadForm";

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const cleaned = v ? cleanLabel(v) : "";
  return cleaned || undefined;
}

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;

  // A moment page links here pre-tagged, so arriving from a show means the
  // venue and date are already right — the two fields people most often get
  // subtly wrong, splitting a pool without noticing.
  const date = one(query.date);
  const prefill: UploadPrefill = {
    who: one(query.who),
    where: one(query.where),
    date: date && isValidEventDate(date) ? date : undefined,
  };

  const user = await getCurrentUser();
  if (!user) {
    const back = new URLSearchParams();
    for (const [k, v] of Object.entries(prefill)) if (v) back.set(k, v);
    const next = back.size > 0 ? `/upload?${back.toString()}` : "/upload";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">Share a moment</h1>
      <p className="mb-1 text-sm muted">
        Tag it with who, where, and when. Anyone who tags the same three lands in
        the same pool as you.
      </p>
      <p className="mb-6 text-sm muted">
        Start typing a tag and pick from the list, or press Enter to create one
        that doesn&rsquo;t exist yet.
      </p>
      <UploadForm prefill={prefill} />
    </div>
  );
}
