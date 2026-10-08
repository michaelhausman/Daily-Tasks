import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Performance Royalties",
  description:
    "Cross-references setlists against PRO statements to find live performances that were never claimed.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Performance<span style={{ color: "#7c5cff" }}>Royalties</span>
            </Link>
            <Link href="/claims" className="text-sm muted hover:opacity-80">
              Claims
            </Link>
            <Link href="/works" className="text-sm muted hover:opacity-80">
              Works
            </Link>
            <Link href="/shows" className="text-sm muted hover:opacity-80">
              Shows
            </Link>
            <Link href="/import" className="text-sm muted hover:opacity-80">
              Import
            </Link>
          </nav>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

        <footer className="mx-auto max-w-6xl px-4 py-10 text-xs muted">
          Private. Holds contracts, statements and earnings — not for sharing.
        </footer>
      </body>
    </html>
  );
}
