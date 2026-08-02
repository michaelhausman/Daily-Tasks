import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";

import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

export const SESSION_COOKIE = "tagpool_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export { newId };

export async function createSession(userId: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });

  return id;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) {
    await db.delete(sessions).where(eq(sessions.id, id));
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Cached per-request so a page that checks auth in the layout, the nav, and a
 * server component doesn't run three identical queries.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const rows = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  return row.user;
});

/** Opportunistic cleanup; called from the signup/login paths. */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
