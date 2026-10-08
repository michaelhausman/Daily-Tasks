"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { ImportState } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary text-sm">
      {pending ? "Reading…" : label}
    </button>
  );
}

export function UploadForm({
  action,
  label,
  children,
}: {
  action: (prev: ImportState, formData: FormData) => Promise<ImportState>;
  label: string;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState<ImportState, FormData>(action, {});

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-2 file:text-sm"
      />
      {children}
      <Submit label={label} />

      {state.error && (
        <p
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "#f0525220", color: "#f05252" }}
        >
          {state.error}
        </p>
      )}
      {state.ok && (
        <div
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "#0e9f6e20" }}
        >
          <p style={{ color: "#0e9f6e" }}>{state.ok}</p>
          {state.detail?.map((line, i) => (
            <p key={i} className="mt-1 text-xs muted">
              {line}
            </p>
          ))}
        </div>
      )}
    </form>
  );
}
