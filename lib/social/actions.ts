"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import {
  addComment,
  deleteComment,
  getCommentAuthor,
  toggleLike,
  toggleMomentFollow,
  toggleTagFollow,
  type CommentTarget,
} from "./service";

export type ActionState = { error?: string };

export async function toggleLikeAction(
  mediaId: string,
): Promise<{ liked: boolean; count: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { liked: false, count: 0, error: "Log in to like things." };

  const result = await toggleLike(user.id, mediaId);
  revalidatePath(`/media/${mediaId}`);
  return result;
}

function targetFromForm(formData: FormData): CommentTarget | null {
  const mediaId = String(formData.get("mediaId") ?? "");
  if (mediaId) return { kind: "media", mediaId };

  const whereSlug = String(formData.get("whereSlug") ?? "");
  const eventDate = String(formData.get("eventDate") ?? "");
  if (whereSlug && eventDate) return { kind: "moment", whereSlug, eventDate };

  return null;
}

export async function addCommentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to comment." };

  const target = targetFromForm(formData);
  if (!target) return { error: "Couldn't work out what you're replying to." };

  const result = await addComment(
    user.id,
    target,
    String(formData.get("body") ?? ""),
  );
  if (!result.ok) return { error: result.error };

  revalidatePath(
    target.kind === "media"
      ? `/media/${target.mediaId}`
      : `/m/${target.whereSlug}/${target.eventDate}`,
  );
  return {};
}

export async function deleteCommentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in first." };

  const id = String(formData.get("commentId") ?? "");
  const authorId = await getCommentAuthor(id);
  if (!authorId) return { error: "That comment is already gone." };

  if (authorId !== user.id && !isAdmin(user.handle)) {
    return { error: "You can only delete your own comments." };
  }

  await deleteComment(id);

  const target = targetFromForm(formData);
  if (target) {
    revalidatePath(
      target.kind === "media"
        ? `/media/${target.mediaId}`
        : `/m/${target.whereSlug}/${target.eventDate}`,
    );
  }
  return {};
}

export async function toggleTagFollowAction(
  tagId: string,
): Promise<{ following: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { following: false, error: "Log in to follow tags." };

  const following = await toggleTagFollow(user.id, tagId);
  revalidatePath("/");
  return { following };
}

export async function toggleMomentFollowAction(
  whereSlug: string,
  eventDate: string,
): Promise<{ following: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { following: false, error: "Log in to follow moments." };

  const following = await toggleMomentFollow(user.id, whereSlug, eventDate);
  revalidatePath("/");
  revalidatePath(`/m/${whereSlug}/${eventDate}`);
  return { following };
}
