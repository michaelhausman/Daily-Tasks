/**
 * Runtime settings, all environment-driven with defaults that suit a small
 * self-hosted instance. Centralized so the deploy docs have one list to
 * describe and there are no magic numbers scattered through route handlers.
 */

function intFromEnv(
  name: string,
  fallback: number,
  // Zero is a real setting for some of these ("off"), and a mistake for the
  // rest (a 0MB upload limit), so each one says which it is.
  { allowZero = false }: { allowZero?: boolean } = {},
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  const floor = allowZero ? 0 : 1;
  return Number.isFinite(parsed) && parsed >= floor
    ? Math.floor(parsed)
    : fallback;
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
 * setlist.fm API key, for importing touring histories from the admin pages.
 *
 * Optional: unset, the admin page says so and the `npm run fetch:setlistfm`
 * script stays the way in. The key is read only on the server and never
 * reaches the browser.
 */
export const SETLISTFM_API_KEY = process.env.SETLISTFM_API_KEY?.trim() || null;

/**
 * How often a loaded performer is re-fetched from setlist.fm, in days.
 *
 * Touring histories go stale forwards: dates get announced, and a show page
 * is most useful to a fan *before* the night rather than after. Re-importing
 * is cheap because it's keyed on performer, place and day — a second run
 * updates in place — so the only real cost is API calls.
 *
 * `SHOW_REFRESH_DAYS=0` turns it off.
 */
export const SHOW_REFRESH_DAYS = intFromEnv("SHOW_REFRESH_DAYS", 7, {
  allowZero: true,
});

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
