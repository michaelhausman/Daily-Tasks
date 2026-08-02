"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { fileReportAction, type ModState } from "@/lib/moderation/actions";

const REASONS: Array<{ value: string; label: string }> = [
  { value: "copyright", label: "Copyright — I hold the rights, or the artist doesn't allow recordings" },
  { value: "abuse", label: "Abusive, hateful, or harassing" },
  { value: "sexual", label: "Sexual content" },
  { value: "spam", label: "Spam or advertising" },
  { value: "wrong-tags", label: "Tagged wrongly — it doesn't belong in this pool" },
  { value: "other", label: "Something else" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? "Sending…" : "Send report"}
    </button>
  );
}

export function ReportButton({
  mediaId,
  commentId,
  whereSlug,
  eventDate,
  loggedIn,
  compact = false,
}: {
  mediaId?: string;
  commentId?: string;
  whereSlug?: string;
  eventDate?: string;
  loggedIn: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ModState, FormData>(
    fileReportAction,
    {},
  );

  if (state.ok) {
    return (
      <p className="text-xs muted">{state.ok}</p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`muted underline hover:opacity-80 ${
          compact ? "text-xs" : "text-sm"
        }`}
      >
        Report
      </button>
    );
  }

  return (
    <form action={formAction} className="surface space-y-3 rounded-xl p-3">
      {mediaId && <input type="hidden" name="mediaId" value={mediaId} />}
      {commentId && <input type="hidden" name="commentId" value={commentId} />}
      {whereSlug && <input type="hidden" name="whereSlug" value={whereSlug} />}
      {eventDate && <input type="hidden" name="eventDate" value={eventDate} />}

      {!loggedIn ? (
        <p className="text-sm muted">
          <a href="/login" style={{ color: "#7c5cff" }}>
            Log in
          </a>{" "}
          to report this.
        </p>
      ) : (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              What&rsquo;s wrong with it?
            </label>
            <select name="reason" required defaultValue="" className="input">
              <option value="" disabled>
                Choose a reason…
              </option>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Anything else? <span className="muted">(optional)</span>
            </label>
            <textarea
              name="note"
              rows={2}
              maxLength={1000}
              placeholder="Context helps — especially for copyright claims."
              className="input resize-y"
            />
          </div>

          {state.error && (
            <p className="text-sm" style={{ color: "#f05252" }}>
              {state.error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <SubmitButton />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-ghost"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  );
}
