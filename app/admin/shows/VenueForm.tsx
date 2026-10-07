"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  mergeVenuesAction,
  separateVenuesAction,
  type SyncState,
} from "@/lib/shows/actions";

function Submit({
  label,
  tone = "ghost",
}: {
  label: string;
  tone?: "ghost" | "primary";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn text-xs"
      style={
        tone === "primary"
          ? { background: "#7c5cff", color: "#fff" }
          : {
              background: "var(--surface-2)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }
      }
    >
      {pending ? "…" : label}
    </button>
  );
}

export type PlaceCandidate = {
  tagId: string;
  label: string;
  venue: string;
  showCount: number;
  /** Context that helps the call: who played, or how many uploads. */
  detail?: string;
};

/**
 * One "are these the same room?" question.
 *
 * Every spelling gets a "keep this one" button, which merges the others into
 * it, because which spelling survives is a real choice: the established one
 * owns the pages people may already have posted to. The opposite answer —
 * genuinely two rooms — has to be recordable too, or the same question comes
 * back after every re-sync until someone clicks the wrong button to stop it.
 *
 * With `eventDate`, the two names collided on one night and "different" is
 * recorded for that night alone. Without it, the question came from comparing
 * names across a whole city, and the answer stands for every date.
 */
export function VenueForm({
  city,
  eventDate,
  places,
}: {
  city: string;
  eventDate?: string;
  places: PlaceCandidate[];
}) {
  const [mergeState, mergeAction] = useActionState<SyncState, FormData>(
    mergeVenuesAction,
    {},
  );
  const [splitState, splitAction] = useActionState<SyncState, FormData>(
    separateVenuesAction,
    {},
  );
  const state = mergeState.error || mergeState.ok ? mergeState : splitState;

  return (
    <li className="py-3" style={{ borderColor: "var(--border)" }}>
      <p className="text-sm font-medium">
        {city}
        {eventDate && <span className="muted"> · {eventDate}</span>}
      </p>

      <ul className="mt-1.5 space-y-1 text-sm">
        {places.map((place) => (
          <li key={place.tagId} className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium">{place.venue}</span>
            <span className="text-xs muted">
              {place.showCount} {place.showCount === 1 ? "show" : "shows"}
              {place.detail && ` · ${place.detail}`}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {places.map((keep) => (
          <form key={keep.tagId} action={mergeAction} className="inline">
            <input type="hidden" name="city" value={city} />
            <input type="hidden" name="intoId" value={keep.tagId} />
            {places
              .filter((p) => p.tagId !== keep.tagId)
              .map((p) => (
                <input key={p.tagId} type="hidden" name="fromId" value={p.tagId} />
              ))}
            {places.map((p) => (
              <input key={p.tagId} type="hidden" name="label" value={p.label} />
            ))}
            <Submit label={`Same room — keep “${keep.venue}”`} tone="primary" />
          </form>
        ))}

        <form action={splitAction} className="inline">
          <input type="hidden" name="city" value={city} />
          {eventDate && (
            <input type="hidden" name="eventDate" value={eventDate} />
          )}
          {places.map((p) => (
            <input key={p.tagId} type="hidden" name="label" value={p.label} />
          ))}
          <Submit label="Different places" />
        </form>

        {state.error && (
          <span className="text-xs" style={{ color: "#f05252" }}>
            {state.error}
          </span>
        )}
        {state.ok && (
          <span className="text-xs" style={{ color: "#0e9f6e" }}>
            {state.ok}
          </span>
        )}
      </div>
    </li>
  );
}
