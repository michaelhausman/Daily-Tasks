import type { NextRequest } from "next/server";

import { searchShows } from "@/lib/shows/service";

/**
 * Shows matching a date and/or some text, for the picker on the upload form.
 *
 * Public: the shows are already public pages, and requiring a session here
 * would mean the picker went blank for someone filling in the form before
 * logging in.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const matches = await searchShows({
    query: params.get("q") ?? undefined,
    date: params.get("date") ?? undefined,
    limit: 12,
  });

  return Response.json({ shows: matches });
}
