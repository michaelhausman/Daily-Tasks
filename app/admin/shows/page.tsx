import Link from "next/link";
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/config";
import {
  keepPlaceAction,
  retrySyncAction,
  startSyncAction,
} from "@/lib/shows/actions";
import {
  activeImport,
  duplicatePlaces,
  inventedPlaces,
  loadedPerformers,
  recentImports,
  refreshStates,
  showStats,
  syncAvailable,
  venueQuestions,
  type ImportJob,
  type RefreshState,
} from "@/lib/shows/sync";
import { SHOW_REFRESH_DAYS } from "@/lib/config";
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

/** When a performer was last pulled from setlist.fm, and what happens next. */
function describeRefresh(state: RefreshState | undefined): string {
  if (!state) return "";
  if (state.stuck) {
    return `auto-refresh paused after ${state.failures} failures`;
  }
  if (!state.lastSuccess) return "never refreshed from setlist.fm";
  const last = `refreshed ${ago(state.lastSuccess)}`;
  if (SHOW_REFRESH_DAYS <= 0) return last;
  if (state.due) return `${last} · due now`;
  if (state.dueAt) return `${last} · next in ${until(state.dueAt)}`;
  return last;
}

function until(at: Date): string {
  const seconds = Math.max(0, (new Date(at).getTime() - Date.now()) / 1000);
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days} ${days === 1 ? "day" : "days"}`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return "under an hour";
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

  const [
    running,
    history,
    performers,
    questions,
    clusters,
    invented,
    refreshes,
    stats,
  ] = await Promise.all([
    activeImport(),
    recentImports(6),
    loadedPerformers(),
    venueQuestions(),
    duplicatePlaces(),
    inventedPlaces(),
    refreshStates(),
    showStats(),
  ]);

  const refreshByLabel = new Map(refreshes.map((r) => [r.label, r]));
  const stuck = refreshes.filter((r) => r.stuck);

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
          {available && SHOW_REFRESH_DAYS > 0 && (
            <>
              {" "}
              Everyone already loaded re-fetches itself every{" "}
              {SHOW_REFRESH_DAYS} days, one artist at a time, so newly
              announced dates turn up on their own. Set{" "}
              <code>SHOW_REFRESH_DAYS=0</code> to stop that.
            </>
          )}
          {available && SHOW_REFRESH_DAYS <= 0 && (
            <> Automatic re-fetching is off (<code>SHOW_REFRESH_DAYS=0</code>).</>
          )}
        </p>

        {stuck.length > 0 && (
          <div
            className="mt-3 rounded-lg px-3 py-2 text-sm"
            style={{ background: "#f0525220" }}
          >
            <p style={{ color: "#f05252" }}>
              Auto-refresh gave up on{" "}
              {stuck.map((s) => s.label).join(", ")} after repeated failures,
              so their dates have stopped updating.
            </p>
            {stuck[0]?.lastError && (
              <p className="mt-1 text-xs muted">Last error: {stuck[0].lastError}</p>
            )}
            <p className="mt-1 text-xs muted">
              Re-sync by hand below — a successful run clears this.
            </p>
          </div>
        )}
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
                city={question.city}
                eventDate={question.eventDate}
                places={question.places.map((p) => ({
                  ...p,
                  detail: p.performers.join(", "),
                }))}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── same-city duplicates, any date ──────────────────────────────── */}
      {clusters.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-bold">
            Possible duplicate places
            <span className="ml-2 text-sm font-normal muted">
              {clusters.length}
            </span>
          </h2>
          <p className="mb-3 max-w-2xl text-sm muted">
            Names in the same city that fold to the same thing once articles,
            punctuation and theatre/theater are set aside — whether or not they
            ever shared a night. The questions above only catch spellings that
            collided on one date; these are the rest.
          </p>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {clusters.map((cluster) => (
              <VenueForm
                key={cluster.places.map((p) => p.tagId).join("|")}
                city={cluster.city}
                places={cluster.places.map((p) => ({
                  ...p,
                  detail:
                    p.uploadCount > 0
                      ? `${p.uploadCount} ${p.uploadCount === 1 ? "upload" : "uploads"}`
                      : undefined,
                }))}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── places people invented ──────────────────────────────────────── */}
      {invented.length > 0 && (
        <section>
          <h2 className="mb-1 text-lg font-bold">
            New places from uploads
            <span className="ml-2 text-sm font-normal muted">
              {invented.length}
            </span>
          </h2>
          <p className="mb-3 max-w-2xl text-sm muted">
            Places somebody typed while uploading, with no imported show behind
            them. Most are real — a club that closed in 1979, a festival field,
            someone&rsquo;s porch. Worth a glance anyway: a venue invented
            beside one that already exists is the mistake that hides best,
            because it looks completely normal to whoever made it.
          </p>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {invented.map((place) => (
              <li
                key={place.tagId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 text-sm"
              >
                <Link
                  href={`/explore?where=${place.slug}`}
                  className="font-medium hover:opacity-80"
                >
                  {place.label}
                </Link>
                <span className="text-xs muted">
                  {place.uploadCount}{" "}
                  {place.uploadCount === 1 ? "upload" : "uploads"} ·{" "}
                  {ago(place.createdAt)}
                </span>
                <span className="flex-1" />
                <ModForm
                  action={keepPlaceAction}
                  label="Looks right"
                  fields={{ tagId: place.tagId }}
                />
              </li>
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
                <span
                  className="text-xs"
                  style={{
                    color: refreshByLabel.get(performer.label)?.stuck
                      ? "#f05252"
                      : "var(--muted)",
                  }}
                >
                  {describeRefresh(refreshByLabel.get(performer.label))}
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
