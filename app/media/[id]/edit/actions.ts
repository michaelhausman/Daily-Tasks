"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { editMedia } from "@/lib/media/edit";
import type { Facet, Visibility } from "@/lib/db/schema";
import type { TagInput } from "@/lib/tags/service";

export type EditState = { error?: string };

export async function saveMediaAction(
  _prev: EditState,
  formData: FormData,
): Promise<EditState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing upload id." };

  const user = await getCurrentUser();

  const tags: TagInput[] = [];
  for (const facet of ["who", "where", "topic"] as Facet[]) {
    for (const raw of formData.getAll(facet)) {
      if (typeof raw === "string" && raw.trim()) {
        tags.push({ facet, label: raw });
      }
    }
  }

  const visibilityRaw = String(formData.get("visibility") ?? "public");
  const visibility: Visibility =
    visibilityRaw === "unlisted" ? "unlisted" : "public";

  const result = await editMedia(id, user, {
    caption: String(formData.get("caption") ?? ""),
    eventDate: String(formData.get("eventDate") ?? "").trim() || null,
    visibility,
    tags,
  });

  if (!result.ok) return { error: result.error };

  // The old moment, the new moment, and every feed listing this item are stale.
  revalidatePath("/", "layout");
  redirect(`/media/${id}`);
}
