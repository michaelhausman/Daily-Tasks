"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { FACET_COLOR } from "@/components/Chip";
import type { ModState } from "@/lib/moderation/actions";
import type { Facet } from "@/lib/db/schema";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary text-xs">
      {pending ? "…" : label}
    </button>
  );
}

export function TagRow({
  tag,
  siblings,
  renameAction,
  mergeAction,
}: {
  tag: {
    id: string;
    facet: Facet;
    slug: string;
    label: string;
    usageCount: number;
    isAlias: boolean;
  };
  siblings: Array<{ id: string; label: string }>;
  renameAction: (prev: ModState, formData: FormData) => Promise<ModState>;
  mergeAction: (prev: ModState, formData: FormData) => Promise<ModState>;
}) {
  const [mode, setMode] = useState<"idle" | "rename" | "merge">("idle");
  const [renameState, doRename] = useActionState<ModState, FormData>(
    renameAction,
    {},
  );
  const [mergeState, doMerge] = useActionState<ModState, FormData>(
    mergeAction,
    {},
  );

  const feedback = renameState.error ?? mergeState.error ?? renameState.ok ?? mergeState.ok;
  const isError = Boolean(renameState.error ?? mergeState.error);

  return (
    <li className="surface rounded-xl p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: FACET_COLOR[tag.facet] }}
        />
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium">{tag.label}</span>{" "}
          <span className="text-xs muted">
            /{tag.slug} · {tag.usageCount}{" "}
            {tag.usageCount === 1 ? "upload" : "uploads"}
          </span>
          {tag.isAlias && (
            <span className="ml-2 text-xs muted">(merged away)</span>
          )}
        </span>

        {mode === "idle" && !tag.isAlias && (
          <>
            <button
              type="button"
              onClick={() => setMode("rename")}
              className="text-xs muted underline hover:opacity-80"
            >
              Rename
            </button>
            {siblings.length > 0 && (
              <button
                type="button"
                onClick={() => setMode("merge")}
                className="text-xs muted underline hover:opacity-80"
              >
                Merge into…
              </button>
            )}
          </>
        )}
      </div>

      {mode === "rename" && (
        <form
          action={doRename}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="tagId" value={tag.id} />
          <input
            name="label"
            defaultValue={tag.label}
            className="input text-sm"
            style={{ width: "16rem" }}
          />
          <Submit label="Save" />
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="btn btn-ghost text-xs"
          >
            Cancel
          </button>
        </form>
      )}

      {mode === "merge" && (
        <form action={doMerge} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="fromId" value={tag.id} />
          <span className="text-xs muted">Move all uploads into</span>
          <select name="intoId" required defaultValue="" className="input text-sm" style={{ width: "16rem" }}>
            <option value="" disabled>
              Choose the surviving tag…
            </option>
            {siblings.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <Submit label="Merge" />
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="btn btn-ghost text-xs"
          >
            Cancel
          </button>
        </form>
      )}

      {feedback && (
        <p
          className="mt-2 text-xs"
          style={{ color: isError ? "#f05252" : "#0e9f6e" }}
        >
          {feedback}
        </p>
      )}
    </li>
  );
}
