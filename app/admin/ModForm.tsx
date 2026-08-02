"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { ModState } from "@/lib/moderation/actions";

function Submit({
  label,
  tone = "ghost",
}: {
  label: string;
  tone?: "ghost" | "danger" | "primary";
}) {
  const { pending } = useFormStatus();
  const style =
    tone === "danger"
      ? { background: "#d93b3b", color: "#fff" }
      : tone === "primary"
        ? { background: "#7c5cff", color: "#fff" }
        : {
            background: "var(--surface-2)",
            color: "var(--text)",
            border: "1px solid var(--border)",
          };

  return (
    <button
      type="submit"
      disabled={pending}
      className="btn text-xs"
      style={style}
    >
      {pending ? "…" : label}
    </button>
  );
}

/**
 * One small form per moderator action. Each keeps its own state so a failure on
 * one row doesn't blank the feedback on another — with a queue you're working
 * through, losing your place is the main thing to avoid.
 */
export function ModForm({
  action,
  label,
  tone = "ghost",
  fields,
  confirm,
  reasonPrompt,
}: {
  action: (prev: ModState, formData: FormData) => Promise<ModState>;
  label: string;
  tone?: "ghost" | "danger" | "primary";
  fields: Record<string, string>;
  confirm?: string;
  reasonPrompt?: string;
}) {
  const [state, formAction] = useActionState<ModState, FormData>(action, {});

  return (
    <form
      action={formAction}
      className="inline-flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {reasonPrompt && (
        <input
          name="reason"
          placeholder={reasonPrompt}
          className="input text-xs"
          style={{ width: "12rem", padding: "0.3rem 0.5rem" }}
        />
      )}
      <Submit label={label} tone={tone} />
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
    </form>
  );
}
