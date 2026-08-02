"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { deleteMediaAction, type DeleteState } from "./actions";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn"
      style={{ background: "#d93b3b", color: "#fff" }}
    >
      {pending ? "Deleting…" : "Yes, delete it"}
    </button>
  );
}

/**
 * Two-step rather than a native confirm() dialog: deletion is irreversible and
 * there is no trash to recover from, so the destructive action should never be
 * one stray click away.
 */
export function DeleteButton({
  mediaId,
  isOwn,
}: {
  mediaId: string;
  isOwn: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [state, formAction] = useActionState<DeleteState, FormData>(
    deleteMediaAction,
    {},
  );

  if (!armed) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="text-sm muted underline hover:opacity-80"
        >
          {isOwn ? "Delete this upload" : "Delete this upload (admin)"}
        </button>
        {state.error && (
          <p className="text-sm" style={{ color: "#d93b3b" }}>
            {state.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={mediaId} />
      <p className="text-sm">
        Delete this permanently? The file and its thumbnails are removed and
        can&rsquo;t be recovered.
      </p>
      <div className="flex flex-wrap gap-2">
        <ConfirmButton />
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="btn btn-ghost"
        >
          Keep it
        </button>
      </div>
      {state.error && (
        <p className="text-sm" style={{ color: "#d93b3b" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
