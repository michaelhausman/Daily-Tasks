"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { startSyncAction, type SyncState } from "@/lib/shows/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary"
      style={{ minWidth: "7rem" }}
    >
      {pending ? "Looking up…" : label}
    </button>
  );
}

/**
 * Type an artist, get their shows.
 *
 * The lookup happens inside the action, so the two outcomes that aren't
 * "started" come back as state: no such artist, or — the interesting one —
 * several artists with that exact name, which becomes a row of buttons rather
 * than a guess. Guessing would file one band's shows under another band's tag,
 * and nobody would notice until a fan did.
 */
export function ImportForm({ disabled }: { disabled?: boolean }) {
  const [state, formAction] = useActionState<SyncState, FormData>(
    startSyncAction,
    {},
  );
  const router = useRouter();

  // A started import shows up as a progress row rendered by the page, so the
  // page needs to re-read once the action returns.
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          defaultValue={state.name ?? ""}
          placeholder="Artist name, e.g. David Bowie"
          className="input"
          style={{ flex: "1 1 16rem", minWidth: 0 }}
          disabled={disabled}
          required
        />
        <Submit label="Import shows" />
      </form>

      {state.error && (
        <p className="text-sm" style={{ color: "#f05252" }}>
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="text-sm" style={{ color: "#0e9f6e" }}>
          {state.ok}
        </p>
      )}

      {state.choices && state.choices.length > 0 && (
        <div
          className="rounded-xl p-3 text-sm"
          style={{ background: "var(--surface-2)" }}
        >
          <p className="mb-2">
            <strong>{state.choices.length} artists</strong> on setlist.fm are
            called exactly &ldquo;{state.name}&rdquo;. Which one?
          </p>
          <div className="flex flex-col gap-2">
            {state.choices.map((artist) => (
              <form key={artist.mbid} action={formAction}>
                <input type="hidden" name="name" value={state.name ?? ""} />
                <input type="hidden" name="mbid" value={artist.mbid} />
                <button
                  type="submit"
                  className="chip w-full text-left"
                  style={{ display: "block" }}
                >
                  {artist.name}
                  {artist.disambiguation && (
                    <span className="muted"> — {artist.disambiguation}</span>
                  )}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Keeps the page in step with a job running on the server.
 *
 * The import writes its progress to a row rather than streaming it, because
 * the work outlives the request that started it — so the page polls. Only
 * while something is actually running: an idle admin page that refetches
 * forever is a background tab quietly making requests all day.
 */
export function ProgressPoller({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [active, router]);

  return null;
}
