"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import { mergeTags } from "@/lib/moderation/service";
import type { SetlistFmArtist } from "./setlistfm";
import {
  recordVenueDecision,
  retryImport,
  startArtistSync,
  venuePartOf,
} from "./sync";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.handle)) return null;
  return user;
}

export type SyncState = {
  error?: string;
  ok?: string;
  /** Set when the name matches more than one artist and someone must pick. */
  choices?: SetlistFmArtist[];
  /** Echoed back so the disambiguation buttons know what was typed. */
  name?: string;
};

export async function startSyncAction(
  _prev: SyncState,
  formData: FormData,
): Promise<SyncState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not allowed." };

  const name = String(formData.get("name") ?? "").trim();
  const mbid = String(formData.get("mbid") ?? "").trim() || undefined;

  const result = await startArtistSync({ name, mbid, userId: user.id });
  revalidatePath("/admin/shows");

  if (result.ok) {
    return { ok: `Importing ${result.performer} — this page will keep up.` };
  }
  if ("choices" in result) {
    return { choices: result.choices, name };
  }
  return { error: result.error, name };
}

export async function retrySyncAction(
  _prev: SyncState,
  formData: FormData,
): Promise<SyncState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not allowed." };

  const id = String(formData.get("id") ?? "");
  const result = await retryImport(id, user.id);
  revalidatePath("/admin/shows");

  if (result.ok) return { ok: `Importing ${result.performer} again.` };
  if ("choices" in result) return { choices: result.choices };
  return { error: result.error };
}

/**
 * "These two names are the same room." Merges the place tags and records the
 * decision.
 *
 * Both halves are needed. The merge fixes the pages that exist now — every
 * show and upload moves to the surviving tag, and the two moment pages become
 * one. The decision fixes the next import: alignment can work out that
 * "Birchmere" and "The Birchmere" agree, but never that the Kitty Carlisle
 * Hart Theatre is inside The Egg, so without a record it would file them apart
 * again on the next re-sync.
 */
export async function mergeVenuesAction(
  _prev: SyncState,
  formData: FormData,
): Promise<SyncState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not allowed." };

  const intoId = String(formData.get("intoId") ?? "");
  const fromIds = formData.getAll("fromId").map(String).filter(Boolean);
  const city = String(formData.get("city") ?? "");
  const labels = formData.getAll("label").map(String).filter(Boolean);

  if (!intoId || fromIds.length === 0 || !city) {
    return { error: "Nothing to merge." };
  }

  const names = labels
    .map((label) => venuePartOf(label, city))
    .filter((v): v is string => v !== null);

  if (names.length > 1) {
    await recordVenueDecision({
      city,
      names,
      different: false,
      userId: user.id,
    });
  }

  let merged = 0;
  for (const fromId of fromIds) {
    if (fromId === intoId) continue;
    const result = await mergeTags(fromId, intoId);
    if (!result.ok) return { error: result.error ?? "Merge failed." };
    merged++;
  }

  revalidatePath("/admin/shows");
  revalidatePath("/explore");
  return {
    ok: `Merged ${merged} ${merged === 1 ? "spelling" : "spellings"} — one page now.`,
  };
}

/** "Two different places that happened to share a night." */
export async function separateVenuesAction(
  _prev: SyncState,
  formData: FormData,
): Promise<SyncState> {
  const user = await requireAdmin();
  if (!user) return { error: "Not allowed." };

  const city = String(formData.get("city") ?? "");
  const eventDate = String(formData.get("eventDate") ?? "") || undefined;
  const labels = formData.getAll("label").map(String).filter(Boolean);
  const note = String(formData.get("reason") ?? "").trim() || undefined;

  const names = labels
    .map((label) => venuePartOf(label, city))
    .filter((v): v is string => v !== null);

  if (!city || names.length < 2) return { error: "Nothing to separate." };

  await recordVenueDecision({
    city,
    names,
    eventDate,
    different: true,
    note,
    userId: user.id,
  });

  revalidatePath("/admin/shows");
  return { ok: "Left as separate places." };
}
