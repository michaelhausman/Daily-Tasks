/**
 * Runtime settings, all environment-driven with defaults that suit a small
 * self-hosted instance. Centralized so the deploy docs have one list to
 * describe and there are no magic numbers scattered through route handlers.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Per-file ceiling. 50MB comfortably covers phone photos and short clips. */
export const MAX_UPLOAD_MB = intFromEnv("MAX_UPLOAD_MB", 50);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/**
 * Uploads allowed per account per hour. Not a security boundary — it's there so
 * one enthusiastic (or malfunctioning) uploader can't fill the disk overnight.
 */
export const UPLOADS_PER_HOUR = intFromEnv("UPLOADS_PER_HOUR", 30);

/**
 * When set, signup requires this code. Browsing and viewing stay public either
 * way — this gates who can *create* content, which is the part that costs you
 * disk and carries moderation risk.
 *
 * Unset means open signup, which keeps local development frictionless.
 */
export const SIGNUP_INVITE_CODE = process.env.SIGNUP_INVITE_CODE?.trim() || null;

export const SIGNUP_OPEN = process.env.SIGNUP_DISABLED !== "true";

/**
 * Handles that may delete anyone's uploads. Comma-separated, case-insensitive.
 * A full role system isn't warranted yet; this is the smallest thing that lets
 * the owner take something down.
 */
const ADMIN_HANDLES = new Set(
  (process.env.ADMIN_HANDLES ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

export function isAdmin(handle: string | undefined | null): boolean {
  if (!handle) return false;
  return ADMIN_HANDLES.has(handle.toLowerCase());
}

export function hasAdmins(): boolean {
  return ADMIN_HANDLES.size > 0;
}
