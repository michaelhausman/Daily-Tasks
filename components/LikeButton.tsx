"use client";

import { useState, useTransition } from "react";

import { toggleLikeAction } from "@/lib/social/actions";

/**
 * Optimistic on purpose. A like is trivially reversible and the round trip is
 * long enough that waiting for it makes the button feel broken; on failure the
 * count rolls back and the reason is shown.
 */
export function LikeButton({
  mediaId,
  initialCount,
  initialLiked,
  loggedIn,
  size = "sm",
}: {
  mediaId: string;
  initialCount: number;
  initialLiked: boolean;
  loggedIn: boolean;
  size?: "sm" | "lg";
}) {
  const [count, setCount] = useState(initialCount);
  const [liked, setLiked] = useState(initialLiked);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!loggedIn) {
      setError("Log in to like this.");
      return;
    }

    const prev = { count, liked };
    setLiked(!liked);
    setCount(count + (liked ? -1 : 1));
    setError(null);

    startTransition(async () => {
      const result = await toggleLikeAction(mediaId);
      if (result.error) {
        setLiked(prev.liked);
        setCount(prev.count);
        setError(result.error);
        return;
      }
      setLiked(result.liked);
      setCount(result.count);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={liked}
        aria-label={liked ? "Unlike" : "Like"}
        className={`inline-flex items-center gap-1.5 rounded-full transition-colors ${
          size === "lg" ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs"
        }`}
        style={{
          background: liked ? "#f0525220" : "var(--surface-2)",
          border: `1px solid ${liked ? "#f05252" : "var(--border)"}`,
          color: liked ? "#f05252" : "var(--text)",
        }}
      >
        <span aria-hidden>{liked ? "♥" : "♡"}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{count}</span>
      </button>
      {error && (
        <span className="text-xs" style={{ color: "#f05252" }}>
          {error}
        </span>
      )}
    </span>
  );
}
