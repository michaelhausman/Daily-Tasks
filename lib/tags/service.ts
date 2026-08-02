import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { tags, type Facet, type Tag } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { cleanLabel, slugify } from "./normalize";

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
        .values({ id, facet, slug, label })
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
    .set({ usageCount: sql`max(0, ${tags.usageCount} + ${delta})` })
    .where(inArray(tags.id, tagIds));
}

/**
 * Typeahead. This is the primary defence against tag fragmentation — showing
 * "Aimee Mann (14)" while someone types "aim" is far more effective than any
 * after-the-fact merge tool, because it prevents the duplicate being created.
 */
export async function suggestTags(
  facet: Facet,
  query: string,
  limit = 8,
): Promise<Tag[]> {
  const slug = slugify(query);

  const rows = await db
    .select()
    .from(tags)
    .where(
      slug
        ? and(
            eq(tags.facet, facet),
            like(tags.slug, `%${slug}%`),
            sql`${tags.canonicalTagId} IS NULL`,
          )
        : and(eq(tags.facet, facet), sql`${tags.canonicalTagId} IS NULL`),
    )
    .orderBy(desc(tags.usageCount), tags.slug)
    .limit(limit * 3);

  if (!slug) return rows.slice(0, limit);

  // Prefer prefix matches over substring matches, then by popularity.
  return rows
    .sort((a, b) => {
      const aPrefix = a.slug.startsWith(slug) ? 0 : 1;
      const bPrefix = b.slug.startsWith(slug) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      return b.usageCount - a.usageCount;
    })
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
