import type { NextRequest } from "next/server";

import { FACETS, type Facet } from "@/lib/db/schema";
import { suggestTags } from "@/lib/tags/service";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const facet = params.get("facet") ?? "";
  const q = params.get("q") ?? "";

  if (!FACETS.includes(facet as Facet)) {
    return Response.json(
      { error: `facet must be one of: ${FACETS.join(", ")}` },
      { status: 400 },
    );
  }

  const results = await suggestTags(facet as Facet, q, 8);

  return Response.json({
    tags: results.map((t) => ({
      slug: t.slug,
      label: t.label,
      usageCount: t.usageCount,
    })),
  });
}
