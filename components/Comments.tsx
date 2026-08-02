"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";

import {
  addCommentAction,
  deleteCommentAction,
  type ActionState,
} from "@/lib/social/actions";
import type { CommentWithAuthor } from "@/lib/social/service";

/** Hidden fields identifying what's being commented on. */
function TargetFields({
  mediaId,
  whereSlug,
  eventDate,
}: {
  mediaId?: string;
  whereSlug?: string;
  eventDate?: string;
}) {
  return (
    <>
      {mediaId && <input type="hidden" name="mediaId" value={mediaId} />}
      {whereSlug && <input type="hidden" name="whereSlug" value={whereSlug} />}
      {eventDate && <input type="hidden" name="eventDate" value={eventDate} />}
    </>
  );
}

function PostButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? "Posting…" : "Post"}
    </button>
  );
}

function timeAgo(date: Date): string {
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export function Comments({
  comments,
  viewerId,
  viewerIsAdmin,
  loggedIn,
  mediaId,
  whereSlug,
  eventDate,
  prompt,
}: {
  comments: CommentWithAuthor[];
  viewerId?: string;
  viewerIsAdmin: boolean;
  loggedIn: boolean;
  mediaId?: string;
  whereSlug?: string;
  eventDate?: string;
  prompt: string;
}) {
  const [addState, addAction] = useActionState<ActionState, FormData>(
    addCommentAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteCommentAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold">
        {comments.length === 0
          ? "Comments"
          : `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}
      </h2>

      {comments.length > 0 && (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="surface rounded-xl p-3">
              <div className="mb-1 flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold">
                  @{c.author.handle}
                </span>
                <span className="text-xs muted">{timeAgo(c.createdAt)}</span>
                {(c.author.id === viewerId || viewerIsAdmin) && (
                  <form action={deleteAction} className="ml-auto">
                    <input type="hidden" name="commentId" value={c.id} />
                    <TargetFields
                      mediaId={mediaId}
                      whereSlug={whereSlug}
                      eventDate={eventDate}
                    />
                    <button
                      type="submit"
                      className="text-xs muted underline hover:opacity-80"
                    >
                      Delete
                    </button>
                  </form>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {deleteState.error && (
        <p className="text-sm" style={{ color: "#f05252" }}>
          {deleteState.error}
        </p>
      )}

      {loggedIn ? (
        <form
          ref={formRef}
          action={async (formData) => {
            await addAction(formData);
            formRef.current?.reset();
          }}
          className="space-y-2"
        >
          <TargetFields
            mediaId={mediaId}
            whereSlug={whereSlug}
            eventDate={eventDate}
          />
          <textarea
            name="body"
            rows={3}
            required
            maxLength={2000}
            placeholder={prompt}
            className="input resize-y"
          />
          {addState.error && (
            <p className="text-sm" style={{ color: "#f05252" }}>
              {addState.error}
            </p>
          )}
          <PostButton />
        </form>
      ) : (
        <p className="text-sm muted">
          <a href="/login" style={{ color: "#7c5cff" }}>
            Log in
          </a>{" "}
          to join the conversation.
        </p>
      )}
    </section>
  );
}
