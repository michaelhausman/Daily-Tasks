/**
 * Tag identity lives and dies by this function.
 *
 * Two people at the same show will type "Aimee Mann", "aimee mann", and maybe
 * "Aimee Mann " with a trailing space. If those become three tag rows, the
 * pooling feature — the whole point of the product — quietly fails, and it
 * fails invisibly: everyone sees their own upload and assumes nobody else
 * posted.
 *
 * So identity is the slug, not the label. We keep the first-typed label for
 * display and match on the slug for everything else.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    // Strip combining marks left behind by NFKD, folding accented forms to ASCII.
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Collapse whitespace so labels don't differ only by spacing. */
export function cleanLabel(input: string): string {
  return input.trim().replace(/\s+/g, " ").slice(0, 120);
}

export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80;
}

/** ISO `YYYY-MM-DD`, rejecting impossible dates like 2026-02-31. */
export function isValidEventDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** `2026-07-24` -> `July 24, 2026`, for chip display. */
export function formatEventDate(value: string): string {
  if (!isValidEventDate(value)) return value;
  return DATE_FORMAT.format(new Date(`${value}T00:00:00Z`));
}
