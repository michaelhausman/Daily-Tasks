import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/session";
import { logOut } from "@/lib/auth/actions";
import { isAdmin } from "@/lib/config";
import { countOpenReports } from "@/lib/moderation/service";
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

  // A badge in the nav is the only thing that makes a moderation queue get
  // looked at; a page you have to remember to visit is a page nobody visits.
  const openReportCount =
    user && isAdmin(user.handle) ? await countOpenReports() : 0;

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
                {isAdmin(user.handle) && (
                  <Link
                    href="/admin"
                    className="hidden text-sm sm:block"
                    style={{ color: "#f05252" }}
                  >
                    Moderation
                    {openReportCount > 0 && ` (${openReportCount})`}
                  </Link>
                )}
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

        <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-10 text-xs muted">
          <span>
            Tagpool — tag what you shot with where and when, and it finds
            everyone else who was there.
          </span>
          <Link href="/rules" className="underline hover:opacity-80">
            House rules
          </Link>
          <Link href="/takedown" className="underline hover:opacity-80">
            Takedown requests
          </Link>
        </footer>
      </body>
    </html>
  );
}
