import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  event_date: string | Date;
  artist: string;
  venue: string | null;
  city: string | null;
  source: string;
  songs: string | number;
  ours: string | number;
};

export default async function ShowsPage() {
  const result = await db.execute(sql`
    SELECT
      s.id, s.event_date, a.name AS artist, s.venue, s.city, s.source,
      (SELECT COUNT(*) FROM performances p WHERE p.show_id = s.id) AS songs,
      (SELECT COUNT(*) FROM performances p
         INNER JOIN works w ON w.id = p.work_id
       WHERE p.show_id = s.id AND w.our_share_bp > 0) AS ours
    FROM shows s INNER JOIN artists a ON a.id = s.artist_id
    ORDER BY s.event_date DESC
    LIMIT 300
  `);
  const rows = (
    Array.isArray(result)
      ? result
      : ((result as unknown as { rows?: unknown[] }).rows ?? [])
  ) as Row[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Shows</h1>
        <p className="mt-1 text-sm muted">
          Most recent 300. &ldquo;Yours&rdquo; counts songs played that you hold
          a writer share in.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm muted">No shows loaded yet.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
            >
              <span className="tabular-nums muted">
                {String(row.event_date).slice(0, 10)}
              </span>
              <span className="min-w-0 flex-1">
                {row.venue ?? row.city ?? "—"}
                <span className="block text-xs muted">
                  {row.artist}
                  {row.source === "manual" && " · entered by hand"}
                </span>
              </span>
              <span className="text-xs muted">
                {Number(row.songs)} songs
                {Number(row.ours) > 0 && ` · ${Number(row.ours)} yours`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
