"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { TagInput } from "@/components/TagInput";
import { saveMediaAction, type EditState } from "./actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function EditForm({
  mediaId,
  initial,
}: {
  mediaId: string;
  initial: {
    caption: string;
    eventDate: string;
    visibility: string;
    who: string[];
    where: string[];
    topic: string[];
  };
}) {
  const [who, setWho] = useState(initial.who);
  const [where, setWhere] = useState(initial.where);
  const [topic, setTopic] = useState(initial.topic);
  const [state, formAction] = useActionState<EditState, FormData>(
    saveMediaAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="id" value={mediaId} />

      {/* Chip state lives in React, so the arrays are mirrored into hidden
          fields for the server action to read. */}
      {who.map((v, i) => (
        <input key={`w${i}`} type="hidden" name="who" value={v} />
      ))}
      {where.map((v, i) => (
        <input key={`r${i}`} type="hidden" name="where" value={v} />
      ))}
      {topic.map((v, i) => (
        <input key={`t${i}`} type="hidden" name="topic" value={v} />
      ))}

      <div className="grid gap-4 sm:grid-cols-2">
        <TagInput
          facet="who"
          label="Who — performer, artist, team, person"
          placeholder="Aimee Mann"
          value={who}
          onChange={setWho}
        />
        <TagInput
          facet="where"
          label="Where — venue, festival, city"
          placeholder="CBGB"
          value={where}
          onChange={setWhere}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            <span
              className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: "#f05252" }}
            />
            When — the date it happened
          </label>
          <input
            type="date"
            name="eventDate"
            defaultValue={initial.eventDate}
            className="input"
          />
          <p className="mt-1 text-xs muted">
            Changing the place or the date moves this into a different moment.
          </p>
        </div>

        <TagInput
          facet="topic"
          label="Topic — optional, anything else"
          placeholder="encore, crowd, soundcheck"
          value={topic}
          onChange={setTopic}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Caption</label>
        <textarea
          name="caption"
          rows={2}
          defaultValue={initial.caption}
          placeholder="What was happening?"
          className="input resize-y"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium">Visibility</label>
        <select
          name="visibility"
          defaultValue={initial.visibility}
          className="input"
        >
          <option value="public">Public — appears in browse and moments</option>
          <option value="unlisted">Unlisted — only people with the link</option>
        </select>
      </div>

      {state.error && (
        <p
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "#f0525220", color: "#f05252" }}
        >
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <SaveButton />
        <Link href={`/media/${mediaId}`} className="btn btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
