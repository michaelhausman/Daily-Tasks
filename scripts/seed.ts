/**
 * Seeds a corpus that demonstrates the core idea on first run: several people
 * independently uploading from the same show, pooling into one moment.
 *
 * Images are generated with sharp rather than fetched, so seeding works offline
 * and adds no binary fixtures to the repo.
 */
import { eq } from "drizzle-orm";
import sharp from "sharp";

import { newId } from "../lib/ids";
import { hashPassword } from "../lib/auth/password";
import { db } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";
import { media, mediaTags, tags, users } from "../lib/db/schema";
import { storage } from "../lib/storage";
import { slugify } from "../lib/tags/normalize";

type SeedUser = { handle: string; displayName: string };

const USERS: SeedUser[] = [
  { handle: "michael", displayName: "Michael Hausman" },
  { handle: "dana_k", displayName: "Dana Kowalski" },
  { handle: "rivera", displayName: "Sam Rivera" },
  { handle: "toneflora", displayName: "Priya Raman" },
];

type SeedItem = {
  owner: string;
  kind: "photo" | "video" | "audio";
  caption: string;
  who: string[];
  where: string[];
  topic: string[];
  eventDate: string;
  /** Two hues that define the generated gradient, so cards look distinct. */
  hues: [number, number];
};

const ITEMS: SeedItem[] = [
  // --- The motivating example: one show, four people, deliberately typed
  // --- with inconsistent casing to prove normalization pools them anyway.
  {
    owner: "michael",
    kind: "video",
    caption: "Save Me, from about ten rows back. Whole crowd singing.",
    who: ["Aimee Mann"],
    where: ["Eau Claire Festival"],
    topic: ["encore"],
    eventDate: "2026-07-24",
    hues: [268, 320],
  },
  {
    owner: "dana_k",
    kind: "photo",
    caption: "Stage right, golden hour hitting the drum kit.",
    who: ["aimee mann"],
    where: ["eau claire festival"],
    topic: [],
    eventDate: "2026-07-24",
    hues: [28, 350],
  },
  {
    owner: "rivera",
    kind: "audio",
    caption: "Board recording of Wise Up. Crowd noise and all.",
    who: ["AIMEE MANN"],
    where: ["Eau Claire Festival"],
    topic: ["soundboard"],
    eventDate: "2026-07-24",
    hues: [200, 260],
  },
  {
    owner: "toneflora",
    kind: "photo",
    caption: "The rail, right before she came out.",
    who: ["Aimee  Mann"],
    where: ["Eau Claire  Festival"],
    topic: ["crowd"],
    eventDate: "2026-07-24",
    hues: [310, 210],
  },

  // --- Same artist, different night: proves the date facet actually separates.
  {
    owner: "dana_k",
    kind: "photo",
    caption: "Different night, Minneapolis. Smaller room, better sound.",
    who: ["Aimee Mann"],
    where: ["First Avenue"],
    topic: [],
    eventDate: "2026-07-27",
    hues: [180, 240],
  },

  // --- Same festival, different artist: proves the who facet separates.
  {
    owner: "michael",
    kind: "photo",
    caption: "Bon Iver closing out the main stage.",
    who: ["Bon Iver"],
    where: ["Eau Claire Festival"],
    topic: ["headliner"],
    eventDate: "2026-07-24",
    hues: [140, 190],
  },
  {
    owner: "rivera",
    kind: "video",
    caption: "Holocene, second song in.",
    who: ["Bon Iver"],
    where: ["Eau Claire Festival"],
    topic: [],
    eventDate: "2026-07-24",
    hues: [95, 160],
  },

  // --- An unrelated moment, so browse isn't single-subject.
  {
    owner: "toneflora",
    kind: "photo",
    caption: "Street set outside the Ferry Building.",
    who: ["The California Honeydrops"],
    where: ["San Francisco"],
    topic: ["busking"],
    eventDate: "2026-06-14",
    hues: [40, 15],
  },
];

async function gradient(
  hues: [number, number],
  label: string,
  size = 1200,
): Promise<Buffer> {
  const [h1, h2] = hues;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(
    size * 0.75,
  )}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${h1},62%,42%)"/>
        <stop offset="100%" stop-color="hsl(${h2},58%,22%)"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="52%" font-family="sans-serif" font-size="46"
          fill="rgba(255,255,255,0.82)" text-anchor="middle">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/** Deterministic pseudo-waveform so seeded audio has a scrubber without ffmpeg. */
function fakeWaveform(seed: number, n = 240): number[] {
  const peaks: number[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const noise = (x / 2147483648) * 0.45;
    // A slow swell so it reads as music rather than static.
    const envelope = 0.35 + 0.4 * Math.abs(Math.sin((i / n) * Math.PI * 3));
    peaks.push(Math.round(Math.min(1, noise + envelope) * 100) / 100);
  }
  return peaks;
}

async function main() {
  await runMigrations();

  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    console.log("Database already has users — skipping seed.");
    console.log("To reseed from scratch: rm -rf .data && npm run seed");
    return;
  }

  console.log("Seeding…");

  const password = await hashPassword("password123");
  const userIds = new Map<string, string>();

  for (const u of USERS) {
    const id = newId();
    userIds.set(u.handle, id);
    await db.insert(users).values({
      id,
      handle: u.handle,
      email: `${u.handle}@example.com`,
      displayName: u.displayName,
      passwordHash: password,
    });
  }
  console.log(`  ${USERS.length} users (password for all: password123)`);

  const tagIds = new Map<string, string>();
  const tagUsage = new Map<string, number>();

  async function tagFor(facet: "who" | "where" | "topic", label: string) {
    const slug = slugify(label);
    const key = `${facet}:${slug}`;

    let id = tagIds.get(key);
    if (!id) {
      id = newId();
      tagIds.set(key, id);
      // The label stored is whichever spelling arrived first — later variants
      // resolve to this same row via the slug.
      await db.insert(tags).values({
        id,
        facet,
        slug,
        label: label.trim().replace(/\s+/g, " "),
      });
    }

    tagUsage.set(key, (tagUsage.get(key) ?? 0) + 1);
    return id;
  }

  let n = 0;
  for (const item of ITEMS) {
    const id = newId();
    const ownerId = userIds.get(item.owner)!;
    const label = `${item.who[0]} — ${item.kind}`;

    const isImageLike = item.kind !== "audio";
    let storageKey: string;
    let bytes = 0;
    let width: number | null = null;
    let height: number | null = null;

    if (isImageLike) {
      const full = await gradient(item.hues, label);
      const ext = item.kind === "video" ? ".mp4" : ".jpg";
      storageKey = `media/${id}/original${ext}`;

      // For seeded "video" there is no real container — the poster and thumb
      // are what the UI actually renders, and playback simply has nothing to
      // play. Enough to exercise every layout path.
      await storage.put(storageKey, full);
      bytes = full.byteLength;

      const meta = await sharp(full).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;

      await storage.put(
        `media/${id}/thumb.webp`,
        await sharp(full)
          .resize(400, 400, { fit: "cover" })
          .webp({ quality: 78 })
          .toBuffer(),
      );
      await storage.put(
        `media/${id}/web.webp`,
        await sharp(full).webp({ quality: 84 }).toBuffer(),
      );
      if (item.kind === "video") {
        await storage.put(
          `media/${id}/poster.webp`,
          await sharp(full).webp({ quality: 82 }).toBuffer(),
        );
      }
    } else {
      // A one-second silent WAV: a real, playable file with a valid header.
      const samples = 44100;
      const data = Buffer.alloc(samples * 2);
      const header = Buffer.alloc(44);
      header.write("RIFF", 0);
      header.writeUInt32LE(36 + data.length, 4);
      header.write("WAVE", 8);
      header.write("fmt ", 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(44100, 24);
      header.writeUInt32LE(88200, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write("data", 36);
      header.writeUInt32LE(data.length, 40);

      const wav = Buffer.concat([header, data]);
      storageKey = `media/${id}/original.wav`;
      await storage.put(storageKey, wav);
      bytes = wav.byteLength;
    }

    await db.insert(media).values({
      id,
      ownerId,
      kind: item.kind,
      storageKey,
      mime:
        item.kind === "audio"
          ? "audio/wav"
          : item.kind === "video"
            ? "video/mp4"
            : "image/jpeg",
      bytes,
      originalName: `seed-${n}`,
      thumbKey: isImageLike ? `media/${id}/thumb.webp` : null,
      webKey: item.kind === "photo" ? `media/${id}/web.webp` : null,
      posterKey: item.kind === "video" ? `media/${id}/poster.webp` : null,
      waveformJson:
        item.kind === "audio" ? JSON.stringify(fakeWaveform(n + 7)) : null,
      width,
      height,
      durationMs:
        item.kind === "audio" ? 1000 : item.kind === "video" ? 42000 : null,
      caption: item.caption,
      eventDate: item.eventDate,
      visibility: "public",
      status: "ready",
      createdAt: new Date(Date.now() - n * 1000 * 60 * 37),
    });

    const links: string[] = [];
    for (const label of item.who) links.push(await tagFor("who", label));
    for (const label of item.where) links.push(await tagFor("where", label));
    for (const label of item.topic) links.push(await tagFor("topic", label));

    const unique = [...new Set(links)];
    if (unique.length > 0) {
      await db
        .insert(mediaTags)
        .values(unique.map((tagId) => ({ mediaId: id, tagId })));
    }

    n++;
  }

  for (const [key, count] of tagUsage) {
    const id = tagIds.get(key)!;
    await db.update(tags).set({ usageCount: count }).where(eq(tags.id, id));
  }

  console.log(`  ${ITEMS.length} uploads across ${tagIds.size} tags`);
  console.log("");
  console.log("Seeded. Try:");
  console.log("  npm run dev");
  console.log("  http://localhost:3000/m/aimee-mann/eau-claire-festival/2026-07-24");
  console.log("");
  console.log("Log in as michael / password123");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
