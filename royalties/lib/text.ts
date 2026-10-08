/**
 * Three sources, three spellings, one song.
 *
 * A setlist title is typed by a fan at a gig. A statement title is typed by a
 * PRO's data entry. A catalogue title is typed by a publisher. They disagree
 * about case, punctuation, articles, accents, and whether the parenthetical
 * belongs — and every disagreement that isn't folded away is a performance
 * that looks unclaimed when it was paid, or paid when it wasn't.
 *
 * So matching happens on a folded key, and the original text is always kept
 * beside it. Anything this folds too aggressively can be corrected with an
 * explicit alias (see `work_titles`), which is safer than a cleverer function
 * nobody can predict.
 */

/** Strict identity: used for names and venues, where collisions are unlikely. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/**
 * Song-title identity.
 *
 * Beyond the usual folding, two title-specific rules:
 *
 * - A trailing parenthetical is dropped. "Save Me (from Magnolia)" and
 *   "Save Me" are one song; the parenthetical is nearly always a film, an
 *   album, a version or a featured artist. A *leading* one is kept, because
 *   "(Don't Fear) The Reaper" is the actual title.
 * - A leading article is dropped, since sources disagree about "The".
 */
export function titleKey(input: string): string {
  let text = input.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();

  // Trailing parentheticals and bracketed notes: "(live)", "[remix]".
  text = text.replace(/\s*[([][^()[\]]*[)\]]\s*$/g, "");
  text = text
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, " ");

  return text.slice(0, 160);
}

/** Venue identity, folding the differences sources argue about. */
export function venueKey(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\btheatre\b/g, "theater")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|and)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** `YYYY-MM-DD`, rejecting impossible dates like 2026-02-31. */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * Dates as they actually arrive: ISO, US slashes, and the `DD-MM-YYYY` that
 * setlist.fm uses. Returns null rather than guessing when it can't tell —
 * a misread date silently files a performance in the wrong claim window.
 */
export function parseDate(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    const value = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidDate(value) ? value : null;
  }

  // setlist.fm's dd-MM-yyyy.
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (dmy) {
    const value = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    return isValidDate(value) ? value : null;
  }

  // M/D/YYYY — US order, which is what statements and spreadsheets use.
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    const value = `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
    return isValidDate(value) ? value : null;
  }

  return null;
}

/**
 * Money as text to integer cents.
 *
 * Cents throughout, never floats: summing ten thousand performances of
 * $0.0037 in binary floating point produces a number you then have to defend
 * to a PRO. Accepts "$1,234.56", "(12.34)" for negatives, and bare numbers.
 */
export function parseMoneyCents(input: string): number | null {
  let text = input.trim();
  if (!text) return null;

  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  text = text.replace(/[()]/g, "").replace(/^-/, "");
  text = text.replace(/[^0-9.]/g, "");
  if (!text || !/^\d*\.?\d*$/.test(text)) return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;

  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

/** Basis points to a readable percentage: 5000 → "50%". */
export function formatShare(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}
