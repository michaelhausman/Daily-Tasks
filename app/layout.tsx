import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { logOut } from "@/lib/auth/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tagpool — everyone's angle on the same moment",
  description:
    "Share photos, video, and audio tagged by who, where, and when — so everybody's media from the same event pools together automatically.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body className="min-h-screen">
        <header
          className="sticky top-0 z-40 backdrop-blur"
          style={{
            background: "color-mix(in srgb, var(--bg) 85%, transparent)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <nav className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Tag<span style={{ color: "#7c5cff" }}>pool</span>
            </Link>

            <Link href="/explore" className="ml-2 text-sm muted hover:opacity-80">
              Explore
            </Link>

            <div className="flex-1" />

            {user ? (
              <>
                <Link href="/upload" className="btn btn-primary">
                  Upload
                </Link>
                <Link
                  href={`/u/${user.handle}`}
                  className="hidden text-sm muted hover:opacity-80 sm:block"
                >
                  @{user.handle}
                </Link>
                <form action={logOut}>
                  <button type="submit" className="text-sm muted hover:opacity-80">
                    Log out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" className="text-sm muted hover:opacity-80">
                  Log in
                </Link>
                <Link href="/signup" className="btn btn-primary">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

        <footer className="mx-auto max-w-6xl px-4 py-10 text-xs muted">
          Tagpool — tag what you shot with who, where, and when, and it finds
          everyone else who was there.
        </footer>
      </body>
    </html>
  );
}
