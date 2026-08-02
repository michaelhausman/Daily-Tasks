"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import { REPORT_REASONS, type ReportReason } from "@/lib/db/schema";
import { deleteMedia } from "@/lib/media/delete";
import { deleteComment } from "@/lib/social/service";
import {
  deleteTag,
  fileReport,
  hideMedia,
  mergeTags,
  reinstateUser,
  renameTag,
  resolveReport,
  suspendUser,
  unhideMedia,
  type ReportTarget,
} from "./service";

export type ModState = { error?: string; ok?: string };

/** Every admin action funnels through this. */
async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.handle)) return null;
  return user;
}

// ─── reporting (any logged-in user) ──────────────────────────────────────────

export async function fileReportAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Log in to report something." };

  const reason = String(formData.get("reason") ?? "");
  if (!REPORT_REASONS.includes(reason as ReportReason)) {
    return { error: "Pick a reason." };
  }

  const mediaId = String(formData.get("mediaId") ?? "");
  const commentId = String(formData.get("commentId") ?? "");
  const whereSlug = String(formData.get("whereSlug") ?? "");
  const eventDate = String(formData.get("eventDate") ?? "");

  let target: ReportTarget;
  if (mediaId) target = { kind: "media", mediaId };
  else if (commentId) target = { kind: "comment", commentId };
  else if (whereSlug && eventDate)
    target = { kind: "moment", whereSlug, eventDate };
  else return { error: "Couldn't tell what you're reporting." };

  const result = await fileReport(
    user.id,
    target,
    reason as ReportReason,
    String(formData.get("note") ?? ""),
  );

  if (!result.ok) return { error: result.error };
  return { ok: "Thanks — this is now in the moderation queue." };
}

// ─── moderator actions ───────────────────────────────────────────────────────

export async function hideMediaAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  const mediaId = String(formData.get("mediaId") ?? "");
  await hideMedia(mediaId, admin.handle, String(formData.get("reason") ?? ""));

  revalidatePath("/admin");
  revalidatePath(`/media/${mediaId}`);
  revalidatePath("/");
  return { ok: "Hidden." };
}

export async function unhideMediaAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  const mediaId = String(formData.get("mediaId") ?? "");
  await unhideMedia(mediaId);

  revalidatePath("/admin");
  revalidatePath(`/media/${mediaId}`);
  revalidatePath("/");
  return { ok: "Restored." };
}

export async function deleteMediaAsAdminAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  const result = await deleteMedia(String(formData.get("mediaId") ?? ""), admin);
  if (!result.ok) return { error: "Couldn't delete that." };

  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: "Deleted permanently." };
}

export async function deleteCommentAsAdminAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  await deleteComment(String(formData.get("commentId") ?? ""));
  revalidatePath("/admin");
  return { ok: "Comment deleted." };
}

export async function suspendUserAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  const userId = String(formData.get("userId") ?? "");
  if (userId === admin.id) return { error: "You can't suspend yourself." };

  const { hiddenCount } = await suspendUser(
    userId,
    admin.handle,
    String(formData.get("reason") ?? ""),
  );

  revalidatePath("/admin");
  revalidatePath("/");
  return {
    ok: `Suspended, and hid ${hiddenCount} ${
      hiddenCount === 1 ? "upload" : "uploads"
    }.`,
  };
}

export async function reinstateUserAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  const { restoredCount } = await reinstateUser(
    String(formData.get("userId") ?? ""),
  );

  revalidatePath("/admin");
  revalidatePath("/");
  return {
    ok: `Reinstated, and restored ${restoredCount} ${
      restoredCount === 1 ? "upload" : "uploads"
    }.`,
  };
}

export async function resolveReportAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  const status = String(formData.get("status") ?? "");
  if (status !== "actioned" && status !== "dismissed") {
    return { error: "Unknown resolution." };
  }

  await resolveReport(String(formData.get("reportId") ?? ""), status, admin.handle);
  revalidatePath("/admin");
  return { ok: status === "actioned" ? "Marked as actioned." : "Dismissed." };
}

// ─── tag moderation ──────────────────────────────────────────────────────────

export async function renameTagAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  const result = await renameTag(
    String(formData.get("tagId") ?? ""),
    String(formData.get("label") ?? ""),
  );
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/tags");
  revalidatePath("/explore");
  return { ok: "Renamed." };
}

export async function mergeTagsAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  const result = await mergeTags(
    String(formData.get("fromId") ?? ""),
    String(formData.get("intoId") ?? ""),
  );
  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/tags");
  revalidatePath("/explore");
  return { ok: `Merged — moved ${result.moved} uploads.` };
}

export async function deleteTagAction(
  _prev: ModState,
  formData: FormData,
): Promise<ModState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not allowed." };

  await deleteTag(String(formData.get("tagId") ?? ""));
  revalidatePath("/admin/tags");
  revalidatePath("/explore");
  return { ok: "Tag deleted. The uploads themselves are untouched." };
}
