"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { deleteMedia } from "@/lib/media/delete";

export type DeleteState = { error?: string };

export async function deleteMediaAction(
  _prev: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing upload id." };

  const user = await getCurrentUser();
  const result = await deleteMedia(id, user);

  if (!result.ok) {
    return {
      error:
        result.reason === "forbidden"
          ? "You can only delete your own uploads."
          : "That upload no longer exists.",
    };
  }

  // The moment pages and feeds that listed this item are now stale.
  revalidatePath("/");
  revalidatePath("/explore");

  redirect(user ? `/u/${user.handle}` : "/");
}
