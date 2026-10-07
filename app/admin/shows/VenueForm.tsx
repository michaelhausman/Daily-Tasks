"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  mergeVenuesAction,
  separateVenuesAction,
  type SyncState,
} from "@/lib/shows/actions";
import type { VenueQuestion } from "@/lib/shows/sync";

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

/**
 * One night where a city holds shows under two place names.
 *
 * Every spelling gets a "keep this one" button, which merges the others into
 * it, because which spelling survives is a real choice: the established one
 * has the pages people may already have posted to. The alternative — "these
 * are two different rooms" — is equally a real answer, and has to be
 * recordable or the same question comes back on the next re-sync.
 */
export function VenueForm({ question }: { question: VenueQuestion }) {
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
        {question.city}
        <span className="muted"> · {question.eventDate}</span>
      </p>

      <ul className="mt-1.5 space-y-1 text-sm">
        {question.places.map((place) => (
          <li key={place.tagId} className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium">{place.venue}</span>
            <span className="text-xs muted">
              {place.showCount} {place.showCount === 1 ? "show" : "shows"}
              {place.performers.length > 0 &&
                ` · ${place.performers.join(", ")}`}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {question.places.map((keep) => (
          <form key={keep.tagId} action={mergeAction} className="inline">
            <input type="hidden" name="city" value={question.city} />
            <input type="hidden" name="intoId" value={keep.tagId} />
            {question.places
              .filter((p) => p.tagId !== keep.tagId)
              .map((p) => (
                <input key={p.tagId} type="hidden" name="fromId" value={p.tagId} />
              ))}
            {question.places.map((p) => (
              <input key={p.tagId} type="hidden" name="label" value={p.label} />
            ))}
            <Submit label={`Same room — keep “${keep.venue}”`} tone="primary" />
          </form>
        ))}

        <form action={splitAction} className="inline">
          <input type="hidden" name="city" value={question.city} />
          <input type="hidden" name="eventDate" value={question.eventDate} />
          {question.places.map((p) => (
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
