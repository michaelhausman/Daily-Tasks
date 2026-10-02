/**
 * Reads an artist's shows from the setlist.fm API and turns them into the same
 * ShowInput rows the touring-history files hold, so they load through the one
 * import path (lib/shows/service.ts) and pool by the same rules.
 *
 * Kept free of database imports: fetching is done on a laptop with the API
 * key, and only the resulting data file travels to the server.
 *
 * API: https://api.setlist.fm/docs/1.0/index.html
 */
import type { ShowInput } from "./service";

const API = "https://api.setlist.fm/rest/1.0";

/** The free tier allows about two requests a second; stay under it. */
const REQUEST_GAP_MS = 600;

export type SetlistFmArtist = {
  mbid: string;
  name: string;
  disambiguation?: string;
  url?: string;
};

type SetlistFmSong = { name?: string; tape?: boolean };

export type SetlistFmSetlist = {
  id: string;
  eventDate: string; // dd-MM-yyyy
  url?: string;
  tour?: { name?: string };
  venue?: {
    name?: string;
    city?: {
      name?: string;
      state?: string;
      stateCode?: string;
      country?: { code?: string; name?: string };
    };
  };
  sets?: { set?: Array<{ song?: SetlistFmSong[] }> };
};

let lastRequest = 0;

async function get<T>(apiKey: string, path: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();

    const res = await fetch(`${API}${path}`, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        "Accept-Language": "en",
      },
    });

    // setlist.fm answers "nothing found" with a 404 rather than an empty list.
    if (res.status === 404) return null;

    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("setlist.fm rejected the API key (check SETLISTFM_API_KEY).");
    }
    if (!res.ok) {
      throw new Error(`setlist.fm ${path}: HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }
}

/** Artists whose name matches exactly, ignoring case — usually one. */
export async function findArtist(
  apiKey: string,
  name: string,
): Promise<SetlistFmArtist[]> {
  const result = await get<{ artist?: SetlistFmArtist[] }>(
    apiKey,
    `/search/artists?artistName=${encodeURIComponent(name)}&sort=relevance`,
  );
  const wanted = name.trim().toLowerCase();
  return (result?.artist ?? []).filter((a) => a.name.trim().toLowerCase() === wanted);
}

/** Every setlist setlist.fm holds for an artist, 20 to a page. */
export async function fetchSetlists(
  apiKey: string,
  mbid: string,
  onPage?: (page: number, pages: number) => void,
): Promise<SetlistFmSetlist[]> {
  const all: SetlistFmSetlist[] = [];
  for (let page = 1; ; page++) {
    const result = await get<{
      setlist?: SetlistFmSetlist[];
      total?: number;
      itemsPerPage?: number;
    }>(apiKey, `/artist/${mbid}/setlists?p=${page}`);

    const batch = result?.setlist ?? [];
    all.push(...batch);

    const pages = Math.ceil((result?.total ?? 0) / (result?.itemsPerPage ?? 20));
    onPage?.(page, pages);
    if (batch.length === 0 || page >= pages) return all;
  }
}

/**
 * One setlist.fm entry as a show row, or null when it lacks a usable date or
 * city.
 *
 * Venue naming has to match the rows already loaded, or the same room on the
 * same night splits into two moments: the venue name exactly as setlist.fm
 * spells it, then the city — the same "Venue, City" label showPlaceLabel()
 * builds. setlist.fm writes "Unknown Venue" when nobody knew the room; that
 * is treated as no venue, and the show is filed under the city.
 */
export function toShowInput(s: SetlistFmSetlist): ShowInput | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.eventDate ?? "");
  const city = s.venue?.city?.name?.trim();
  if (!m || !city) return null;

  const venue = s.venue?.name?.trim();
  const country = s.venue?.city?.country?.code;
  const stateCode = s.venue?.city?.stateCode;

  // US and Canadian state codes read naturally ("Portland, OR"); elsewhere
  // setlist.fm's codes are numeric region ids, which mean nothing on a page.
  const region =
    stateCode && /^[A-Za-z]{2,3}$/.test(stateCode) && (country === "US" || country === "CA")
      ? stateCode.toUpperCase()
      : undefined;

  // Tape entries are walk-on and intro music, not songs the artist played.
  const setlist = (s.sets?.set ?? [])
    .flatMap((set) => set.song ?? [])
    .filter((song) => !song.tape && song.name?.trim())
    .map((song) => song.name!.trim());

  return {
    date: `${m[3]}-${m[2]}-${m[1]}`,
    ...(venue && !/^unknown venue$/i.test(venue) ? { venue } : {}),
    city,
    ...(region ? { region } : {}),
    ...(s.tour?.name?.trim() ? { tour: s.tour.name.trim() } : {}),
    ...(setlist.length ? { setlist } : {}),
    ...(s.url ? { setlistUrl: s.url } : {}),
  };
}

/**
 * Two setlist.fm entries for one performer, place and day are one show as far
 * as a moment is concerned (an early and a late set, or a duplicate entry).
 * Keep one row, with the longer setlist and whatever details either has.
 */
export function mergeSameShow(rows: ShowInput[]): ShowInput[] {
  const byKey = new Map<string, ShowInput>();
  for (const row of rows) {
    const key = `${row.date}|${(row.venue ?? "").toLowerCase()}|${row.city.toLowerCase()}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, {
      ...row,
      ...seen,
      region: seen.region ?? row.region,
      tour: seen.tour ?? row.tour,
      setlistUrl: seen.setlistUrl ?? row.setlistUrl,
      setlist:
        (row.setlist?.length ?? 0) > (seen.setlist?.length ?? 0) ? row.setlist : seen.setlist,
    });
  }
  return [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.venue ?? "").localeCompare(b.venue ?? ""),
  );
}
