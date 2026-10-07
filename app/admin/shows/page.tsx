import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import { retrySyncAction, startSyncAction } from "@/lib/shows/actions";
import {
  activeImport,
  loadedPerformers,
  recentImports,
  showStats,
  syncAvailable,
  venueQuestions,
  type ImportJob,
} from "@/lib/shows/sync";
import { ModForm } from "../ModForm";
import { ImportForm, ProgressPoller } from "./ImportForm";
import { VenueForm } from "./VenueForm";

export const dynamic = "force-dynamic";

/**
 * Elapsed time rather than a clock reading. A timestamp rendered on the server
 * is in the server's zone — UTC on Railway — which would quietly mislabel
 * anything run in the evening. "12 minutes ago" is both correct everywhere and
 * what you actually want to know about an import.
 */
function ago(at: Date | string): string {
  const seconds = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const units: Array<[seconds: number, name: string]> = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

function describe(job: ImportJob): string {
  if (job.stale) return "Stopped partway — the server restarted mid-import.";
  switch (job.status) {
    case "queued":
      return "Starting…";
    case "fetching":
      return job.pages > 0
        ? `Reading setlist.fm — page ${job.page} of ${job.pages}`
        : "Reading setlist.fm…";
    case "importing":
      return `Loading ${job.fetched} setlists into the site…`;
    case "failed":
      return job.error ?? "Failed.";
    case "done": {
      const bits = [
        job.added > 0 && `${job.added} new`,
        job.updated > 0 && `${job.updated} updated`,
        job.skipped > 0 && `${job.skipped} skipped`,
        job.aligned > 0 && `${job.aligned} venue spellings matched`,
      ].filter(Boolean);
      return bits.length > 0 ? bits.join(", ") : "Nothing to change.";
    }
  }
}

export default async function AdminShowsPage() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.handle)) notFound();

  const [running, history, performers, questions, stats] = await Promise.all([
    activeImport(),
    recentImports(6),
    loadedPerformers(),
    venueQuestions(),
    showStats(),
  ]);

  const available = syncAvailable();

  return (
    <div className="space-y-8">
      <ProgressPoller active={running !== null} />

      <header>
        <h1 className="text-2xl font-bold">Shows</h1>
        <p className="mt-1 text-sm muted">
          <Link href="/admin" style={{ color: "#7c5cff" }}>
            ← Back to moderation
          </Link>
        </p>
        <p className="mt-3 max-w-2xl text-sm muted">
          Importing a performer&rsquo;s touring history gives every show a page
          before anyone posts to it, so the first person who was there finds a
          page that already knows who played — not an empty box. Re-importing
          the same artist updates in place and picks up newly announced dates.
        </p>
        <p className="mt-3 text-sm muted">
          {stats.shows.toLocaleString()} shows ·{" "}
          {stats.moments.toLocaleString()} moment pages ·{" "}
          {stats.venues.toLocaleString()} places
        </p>
      </header>

      {/* ── import ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-bold">Import an artist</h2>

        {!available ? (
          <p
            className="rounded-lg px-3 py-2 text-sm"
            style={{ background: "#f0525220", color: "#f05252" }}
          >
            SETLISTFM_API_KEY isn&rsquo;t set on the server, so imports
            can&rsquo;t run from here. Add it in Railway → Variables (a free key
            comes from setlist.fm → Settings → API), or keep using{" "}
            <code>npm run fetch:setlistfm</code> from a laptop.
          </p>
        ) : running ? (
          <p className="text-sm muted">
            Importing <strong>{running.performer}</strong> — {describe(running)}
            . One at a time; setlist.fm&rsquo;s rate limit is shared across the
            whole site.
          </p>
        ) : (
          <ImportForm />
        )}

        <p className="mt-3 max-w-2xl text-xs muted">
          A long career is a few minutes of fetching — setlist.fm allows about
          two requests a second and the import stays under it. You can leave
          this page; the job keeps running and the progress is here when you
          come back.
        </p>
      </section>

      {/* ── venue questions ─────────────────────────────────────────────── */}
      {questions.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-bold">
            Same room, or two rooms?
            <span className="ml-2 text-sm font-normal muted">
              {questions.length}
            </span>
          </h2>
          <p className="mb-3 max-w-2xl text-sm muted">
            These nights have shows filed under two different place names in one
            city. Importing can tell that &ldquo;Birchmere&rdquo; and
            &ldquo;The Birchmere&rdquo; are one place, but not that the Kitty
            Carlisle Hart Theatre is inside The Egg — that needs someone who
            knows. Until you answer, each spelling has its own page, so anyone
            posting from that night may land on the wrong one.
          </p>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {questions.map((question) => (
              <VenueForm
                key={`${question.city}|${question.eventDate}`}
                question={question}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── loaded performers ───────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-lg font-bold">
          Loaded
          <span className="ml-2 text-sm font-normal muted">
            {performers.length}
          </span>
        </h2>

        {performers.length === 0 ? (
          <p className="text-sm muted">No touring histories yet.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {performers.map((performer) => (
              <li
                key={performer.slug}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3"
              >
                <Link
                  href={`/shows/${performer.slug}`}
                  className="font-medium hover:opacity-80"
                >
                  {performer.label}
                </Link>
                <span className="text-xs muted">
                  {performer.showCount.toLocaleString()} shows ·{" "}
                  {performer.firstDate.slice(0, 4)}–
                  {performer.lastDate.slice(0, 4)} · {performer.withSetlists}{" "}
                  with setlists
                </span>
                <span className="flex-1" />
                {available && !running && (
                  <ModForm
                    action={startSyncAction}
                    label="Re-sync"
                    fields={{ name: performer.label }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── history ─────────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">Recent imports</h2>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {history.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 text-sm"
              >
                <span className="font-medium">{job.performer}</span>
                <span
                  className="text-xs"
                  style={{
                    color:
                      job.status === "failed" || job.stale
                        ? "#f05252"
                        : job.status === "done"
                          ? "#0e9f6e"
                          : "var(--muted)",
                  }}
                >
                  {describe(job)}
                </span>
                <span className="text-xs muted">{ago(job.createdAt)}</span>
                <span className="flex-1" />
                {available &&
                  !running &&
                  (job.status === "failed" || job.stale) && (
                    <ModForm
                      action={retrySyncAction}
                      label="Try again"
                      fields={{ id: job.id }}
                    />
                  )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
