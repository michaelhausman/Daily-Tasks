"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { FACET_COLOR } from "@/components/Chip";
import type { ModState } from "@/lib/moderation/actions";
import type { Facet } from "@/lib/db/schema";
import { MergePicker } from "./MergePicker";

function Submit({
  label,
  tone = "primary",
}: {
  label: string;
  tone?: "primary" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn text-xs"
      style={
        tone === "danger"
          ? { background: "#d93b3b", color: "#fff" }
          : { background: "#7c5cff", color: "#fff" }
      }
    >
      {pending ? "…" : label}
    </button>
  );
}

export function TagRow({
  tag,
  renameAction,
  mergeAction,
  deleteAction,
}: {
  tag: {
    id: string;
    facet: Facet;
    slug: string;
    label: string;
    usageCount: number;
    showCount: number;
    aliasOf: string | null;
  };
  renameAction: (prev: ModState, formData: FormData) => Promise<ModState>;
  mergeAction: (prev: ModState, formData: FormData) => Promise<ModState>;
  deleteAction: (prev: ModState, formData: FormData) => Promise<ModState>;
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
  const [deleteState, doDelete] = useActionState<ModState, FormData>(
    deleteAction,
    {},
  );

  const feedback =
    renameState.error ??
    mergeState.error ??
    deleteState.error ??
    renameState.ok ??
    mergeState.ok ??
    deleteState.ok;
  const isError = Boolean(
    renameState.error ?? mergeState.error ?? deleteState.error,
  );

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
            {tag.showCount > 0 &&
              ` · ${tag.showCount.toLocaleString()} ${
                tag.showCount === 1 ? "show" : "shows"
              }`}
          </span>
          {tag.aliasOf && (
            <span className="ml-2 text-xs muted">→ merged into {tag.aliasOf}</span>
          )}
        </span>

        {mode === "idle" && !tag.aliasOf && (
          <>
            <button
              type="button"
              onClick={() => setMode("rename")}
              className="text-xs muted underline hover:opacity-80"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => setMode("merge")}
              className="text-xs muted underline hover:opacity-80"
            >
              Merge into…
            </button>
            <form
              action={doDelete}
              className="inline"
              onSubmit={(e) => {
                if (
                  !window.confirm(
                    `Delete the tag "${tag.label}"?` +
                      (tag.showCount > 0
                        ? `\n\nThis tag has ${tag.showCount} imported shows, which will be deleted with it.`
                        : "\n\nUploads keep their files but lose this tag."),
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="tagId" value={tag.id} />
              <button
                type="submit"
                className="text-xs underline hover:opacity-80"
                style={{ color: "#f05252" }}
              >
                Delete
              </button>
            </form>
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
          <input type="hidden" name="facet" value={tag.facet} />
          <span className="text-xs muted">Move everything into</span>
          <MergePicker facet={tag.facet} />
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
