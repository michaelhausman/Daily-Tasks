"use server";

import { eq, or } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { hashPassword, verifyPassword } from "./password";
import { createSession, destroySession, purgeExpiredSessions } from "./session";

export type AuthState = { error?: string };

const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const handle = String(formData.get("handle") ?? "")
    .trim()
    .toLowerCase();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const displayName =
    String(formData.get("displayName") ?? "").trim() || handle;

  if (!HANDLE_RE.test(handle)) {
    return {
      error: "Handle must be 3-24 characters: lowercase letters, numbers, underscores.",
    };
  }
  if (!EMAIL_RE.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.handle, handle), eq(users.email, email)))
    .limit(1);

  if (existing.length > 0) {
    // Deliberately vague: naming which field collided turns signup into an
    // account-enumeration oracle.
    return { error: "That handle or email is already taken." };
  }

  await purgeExpiredSessions();

  const id = newId();
  await db.insert(users).values({
    id,
    handle,
    email,
    displayName,
    passwordHash: await hashPassword(password),
  });

  await createSession(id);
  redirect("/upload");
}

export async function logIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const identifier = String(formData.get("identifier") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!identifier || !password) {
    return { error: "Enter your handle or email, and your password." };
  }

  const rows = await db
    .select()
    .from(users)
    .where(or(eq(users.handle, identifier), eq(users.email, identifier)))
    .limit(1);

  const user = rows[0];

  // Hash even when the user doesn't exist, so response time doesn't reveal
  // which handles are registered.
  const hash =
    user?.passwordHash ??
    "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
  const ok = await verifyPassword(password, hash);

  if (!user || !ok) {
    return { error: "Incorrect handle/email or password." };
  }

  await purgeExpiredSessions();
  await createSession(user.id);
  redirect("/");
}

export async function logOut(): Promise<void> {
  await destroySession();
  redirect("/");
}
