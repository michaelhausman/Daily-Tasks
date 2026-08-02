"use client";

import { useState, useTransition } from "react";

import {
  toggleMomentFollowAction,
  toggleTagFollowAction,
} from "@/lib/social/actions";

type Target =
  | { kind: "tag"; tagId: string }
  | { kind: "moment"; whereSlug: string; eventDate: string };

export function FollowButton({
  target,
  initialFollowing,
  loggedIn,
  label = "Follow",
}: {
  target: Target;
  initialFollowing: boolean;
  loggedIn: boolean;
  label?: string;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!loggedIn) {
      setError("Log in to follow.");
      return;
    }

    const prev = following;
    setFollowing(!following);
    setError(null);

    startTransition(async () => {
      const result =
        target.kind === "tag"
          ? await toggleTagFollowAction(target.tagId)
          : await toggleMomentFollowAction(target.whereSlug, target.eventDate);

      if (result.error) {
        setFollowing(prev);
        setError(result.error);
        return;
      }
      setFollowing(result.following);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={following}
        className="btn"
        style={
          following
            ? {
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }
            : { background: "#7c5cff", color: "#fff" }
        }
      >
        {following ? "Following" : label}
      </button>
      {error && (
        <span className="text-xs" style={{ color: "#f05252" }}>
          {error}
        </span>
      )}
    </span>
  );
}
