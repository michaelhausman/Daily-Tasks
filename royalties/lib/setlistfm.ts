/**
 * Reads an artist's shows from the setlist.fm API.
 *
 * Lifted from Tagpool, where the same client fetches the same data for a
 * different purpose. Copied rather than shared: this app holds contracts and
 * royalty statements, and must not depend on a public photo site to build.
 *
 * Kept free of database imports so it can run from a script or a server
 * action without dragging a connection along.
 *
 * API: https://api.setlist.fm/docs/1.0/index.html
 */
import type { ShowInput } from "@/lib/import/shows";

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
 * setlist.fm writes "Unknown Venue" when nobody knew the room; that is treated
 * as no venue, and the show is keyed on its city instead.
 */
export function toShowInput(
  s: SetlistFmSetlist,
  artist: string,
): ShowInput | null {
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
    artist,
    date: `${m[3]}-${m[2]}-${m[1]}`,
    ...(venue && !/^unknown venue$/i.test(venue) ? { venue } : {}),
    city,
    ...(region ? { region } : {}),
    ...(country ? { country } : {}),
    ...(s.tour?.name?.trim() ? { tour: s.tour.name.trim() } : {}),
    // An empty setlist means nobody logged one, which is different from a
    // show where nothing was played — so it is left undefined rather than [],
    // and importing won't wipe a setlist entered by hand.
    ...(setlist.length ? { setlist } : {}),
    ...(s.url ? { setlistUrl: s.url } : {}),
    source: "setlistfm" as const,
  };
}
