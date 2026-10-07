import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { shows, tags, type Facet, type Tag } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { cleanLabel, matchKey, slugify } from "./normalize";

export type TagInput = { facet: Facet; label: string };

/**
 * Resolve a typed label to a tag row, creating it if new, and following alias
 * pointers so a merged tag never gets written to again.
 */
export async function resolveTag(facet: Facet, rawLabel: string): Promise<Tag | null> {
  const label = cleanLabel(rawLabel);
  const slug = slugify(label);
  if (!slug) return null;

  const existing = await db
    .select()
    .from(tags)
    .where(and(eq(tags.facet, facet), eq(tags.slug, slug)))
    .limit(1);

  let tag = existing[0];

  if (!tag) {
    const id = newId();
    // Two uploads naming the same new tag can race here; the unique index on
    // (facet, slug) is the arbiter, and the loser re-reads the winner's row.
    try {
      const inserted = await db
        .insert(tags)
        .values({ id, facet, slug, label, matchKey: matchKey(label) })
        .returning();
      tag = inserted[0];
    } catch {
      const reread = await db
        .select()
        .from(tags)
        .where(and(eq(tags.facet, facet), eq(tags.slug, slug)))
        .limit(1);
      tag = reread[0];
    }
  }

  if (!tag) return null;

  if (tag.canonicalTagId) {
    const canonical = await db
      .select()
      .from(tags)
      .where(eq(tags.id, tag.canonicalTagId))
      .limit(1);
    if (canonical[0]) return canonical[0];
  }

  return tag;
}

export async function resolveTags(inputs: TagInput[]): Promise<Tag[]> {
  const resolved: Tag[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const tag = await resolveTag(input.facet, input.label);
    if (tag && !seen.has(tag.id)) {
      seen.add(tag.id);
      resolved.push(tag);
    }
  }

  return resolved;
}

export async function bumpUsage(tagIds: string[], delta = 1): Promise<void> {
  if (tagIds.length === 0) return;
  await db
    .update(tags)
    // GREATEST, not max() — in Postgres max() is an aggregate, and the
    // two-argument scalar form only exists in SQLite.
    .set({ usageCount: sql`GREATEST(0, ${tags.usageCount} + ${delta})` })
    .where(inArray(tags.id, tagIds));
}

export type Suggestion = Tag & {
  /** Imported shows behind this tag — what makes it a known venue or artist. */
  showCount: number;
};

/**
 * Typeahead. This is the primary defence against tag fragmentation — showing
 * "Aimee Mann (14)" while someone types "aim" is far more effective than any
 * after-the-fact merge tool, because it prevents the duplicate being created.
 *
 * Two things make it work against a curated list rather than against it.
 *
 * It matches on the loose key as well as the slug, so "wilbur theater" finds
 * "The Wilbur Theatre, Boston" instead of reporting nothing and offering to
 * create a sibling. And it counts imported shows, not just uploads: a venue
 * loaded from a touring history has a usage count of zero until somebody posts
 * from it, which would otherwise rank the whole curated list beneath any tag
 * a single person had used once.
 */
export async function suggestTags(
  facet: Facet,
  query: string,
  limit = 8,
): Promise<Suggestion[]> {
  const slug = slugify(query);
  const key = matchKey(query);

  const matches: SQL[] = [];
  if (slug) matches.push(like(tags.slug, `%${slug}%`));
  if (key) matches.push(like(tags.matchKey, `%${key}%`));

  const rows = await db
    .select()
    .from(tags)
    .where(
      and(
        eq(tags.facet, facet),
        sql`${tags.canonicalTagId} IS NULL`,
        ...(matches.length > 0 ? [or(...matches)!] : []),
      ),
    )
    .orderBy(desc(tags.usageCount), tags.label)
    // Widened because ordering by usage alone no longer reflects the final
    // ranking: a known venue with no uploads has to survive this cut.
    .limit(limit * 8);

  const withShows = await showCounts(rows.map((t) => t.id));
  const suggestions: Suggestion[] = rows.map((t) => ({
    ...t,
    showCount: withShows.get(t.id) ?? 0,
  }));

  if (!slug && !key) {
    return suggestions
      .sort((a, b) => b.showCount - a.showCount || b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  return suggestions.sort((a, b) => rank(a, slug, key) - rank(b, slug, key)).slice(0, limit);
}

/**
 * Lower is better. Exactness first, then whether the tag is something we know
 * is real, and popularity only as a tiebreak — a curated venue should beat a
 * busy one-off, because the busy one-off is often the duplicate.
 */
function rank(tag: Suggestion, slug: string, key: string): number {
  let score = 0;
  if (tag.slug === slug) score -= 1000;
  else if (key && tag.matchKey === key) score -= 800;
  else if (slug && tag.slug.startsWith(slug)) score -= 400;
  else if (key && tag.matchKey?.startsWith(key)) score -= 300;

  if (tag.showCount > 0) score -= 100;
  // Compressed so a tag with a thousand uploads can't outrank exactness.
  score -= Math.min(50, Math.log10(1 + tag.usageCount) * 20);
  score -= Math.min(30, Math.log10(1 + tag.showCount) * 10);
  return score;
}

async function showCounts(tagIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (tagIds.length === 0) return counts;

  const rows = await db
    .select({
      whoTagId: shows.whoTagId,
      whereTagId: shows.whereTagId,
      n: sql<string>`count(*)`,
    })
    .from(shows)
    .where(
      or(inArray(shows.whoTagId, tagIds), inArray(shows.whereTagId, tagIds)),
    )
    .groupBy(shows.whoTagId, shows.whereTagId);

  const wanted = new Set(tagIds);
  for (const row of rows) {
    for (const id of [row.whoTagId, row.whereTagId]) {
      if (!wanted.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + Number(row.n));
    }
  }
  return counts;
}

/**
 * Tags whose loose key matches, excluding ones that already match exactly.
 *
 * This is the "did you mean" set: what to show someone who is about to invent
 * a place that already exists under a slightly different spelling.
 */
export async function nearMatches(
  facet: Facet,
  label: string,
  limit = 3,
): Promise<Suggestion[]> {
  const key = matchKey(label);
  const slug = slugify(label);
  if (!key) return [];

  const found = await suggestTags(facet, label, limit + 3);
  return found
    .filter((t) => t.slug !== slug)
    .filter((t) => t.matchKey === key || t.matchKey?.includes(key) || key.includes(t.matchKey ?? "\0"))
    .slice(0, limit);
}

export async function getTagsBySlugs(
  pairs: Array<{ facet: Facet; slug: string }>,
): Promise<Tag[]> {
  if (pairs.length === 0) return [];

  const rows = await db
    .select()
    .from(tags)
    .where(
      sql`(${sql.join(
        pairs.map((p) => sql`(${tags.facet} = ${p.facet} AND ${tags.slug} = ${p.slug})`),
        sql` OR `,
      )})`,
    );

  return rows;
}
