import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { UploadForm } from "./UploadForm";

export default async function UploadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/upload");

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
      <UploadForm />
    </div>
  );
}
