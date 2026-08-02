"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { AuthState } from "@/lib/auth/actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full">
      {pending ? "…" : label}
    </button>
  );
}

export function AuthForm({
  mode,
  action,
  inviteRequired = false,
}: {
  mode: "login" | "signup";
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  inviteRequired?: boolean;
}) {
  const [state, formAction] = useActionState<AuthState, FormData>(action, {});
  const isSignup = mode === "signup";

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-2xl font-bold">
        {isSignup ? "Create an account" : "Welcome back"}
      </h1>
      <p className="mb-6 text-sm muted">
        {isSignup
          ? "You need an account to upload. Browsing is open to everyone."
          : "Log in to upload and manage your media."}
      </p>

      <form action={formAction} className="space-y-4">
        {isSignup ? (
          <>
            {inviteRequired && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Invite code
                </label>
                <input
                  name="inviteCode"
                  required
                  autoComplete="off"
                  placeholder="From whoever invited you"
                  className="input"
                />
                <p className="mt-1 text-xs muted">
                  This instance is invite-only while it&rsquo;s being tested.
                  Browsing is open to everyone.
                </p>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Handle</label>
              <input
                name="handle"
                required
                autoComplete="username"
                placeholder="mhausman"
                className="input"
              />
              <p className="mt-1 text-xs muted">
                Lowercase letters, numbers, underscores. 3–24 characters.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Display name
              </label>
              <input
                name="displayName"
                autoComplete="name"
                placeholder="Michael Hausman"
                className="input"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="input"
              />
            </div>
          </>
        ) : (
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Handle or email
            </label>
            <input
              name="identifier"
              required
              autoComplete="username"
              className="input"
            />
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Password</label>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={isSignup ? "new-password" : "current-password"}
            className="input"
          />
        </div>

        {state.error && (
          <p
            className="rounded-lg px-3 py-2 text-sm"
            style={{ background: "#f0525220", color: "#f05252" }}
          >
            {state.error}
          </p>
        )}

        <SubmitButton label={isSignup ? "Sign up" : "Log in"} />
      </form>

      <p className="mt-5 text-center text-sm muted">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" style={{ color: "#7c5cff" }}>
              Log in
            </Link>
          </>
        ) : (
          <>
            No account?{" "}
            <Link href="/signup" style={{ color: "#7c5cff" }}>
              Sign up
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
