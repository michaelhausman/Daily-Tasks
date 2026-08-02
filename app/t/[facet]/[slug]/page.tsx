import { redirect } from "next/navigation";

import { FACETS, type Facet } from "@/lib/db/schema";
import { isValidSlug } from "@/lib/tags/normalize";

/**
 * Single-tag permalinks are just a pre-filled explore view, so redirect rather
 * than maintaining a second browse implementation.
 */
export default async function TagPage({
  params,
}: {
  params: Promise<{ facet: string; slug: string }>;
}) {
  const { facet, slug } = await params;

  if (!FACETS.includes(facet as Facet) || !isValidSlug(slug)) {
    redirect("/explore");
  }

  redirect(`/explore?${facet}=${slug}`);
}
