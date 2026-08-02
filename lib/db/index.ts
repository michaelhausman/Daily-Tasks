import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { Pool, types as pgTypes } from "pg";

import * as schema from "./schema";

/**
 * Return DATE columns as the raw `YYYY-MM-DD` string.
 *
 * By default node-postgres parses OID 1082 (DATE) into a JS Date at *local*
 * midnight. For `media.event_date` that is actively wrong: a server running
 * anywhere west of UTC turns 2026-07-24 into 2026-07-23T19:00 local, and the
 * date facet starts pooling uploads under the wrong day. The value has no time
 * and no timezone, so it should never become a Date at all.
 */
pgTypes.setTypeParser(pgTypes.builtins.DATE, (value) => value);

/**
 * One dialect, two engines.
 *
 * Production points `DATABASE_URL` at a real Postgres server. Local development
 * with no env set runs PGlite — actual Postgres compiled to WebAssembly, in
 * process, backed by a directory. Not an emulation: `string_agg`, `DISTINCT ON`,
 * window functions, and the moment query all behave identically.
 *
 * The payoff is that there is exactly one schema and one set of SQL. The usual
 * SQLite-locally/Postgres-in-production split means every raw query has to be
 * written twice and the two versions drift until something breaks only in
 * production.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PGLITE_DIR =
  process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pg");

export const usingRealPostgres = Boolean(DATABASE_URL);

function createClient() {
  if (DATABASE_URL) {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      // Managed Postgres almost always terminates TLS with a certificate the
      // Node trust store doesn't recognise. Opt out only when the URL asks.
      ssl: /[?&]sslmode=(require|prefer)/.test(DATABASE_URL)
        ? { rejectUnauthorized: false }
        : undefined,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    pool.on("error", (err) => {
      // A dropped idle connection must not take the process down.
      console.error("[db] idle client error:", err.message);
    });

    return drizzleNodePg(pool, { schema });
  }

  // PGlite creates its own data directory but not the parents above it.
  fs.mkdirSync(path.dirname(PGLITE_DIR), { recursive: true });
  return drizzlePglite(new PGlite(PGLITE_DIR), { schema });
}

// Next's dev server re-evaluates modules on every hot reload; without this the
// process accumulates connection pools until Postgres refuses new clients.
const globalForDb = globalThis as unknown as {
  __tagpoolDb?: ReturnType<typeof createClient>;
};

export const db = globalForDb.__tagpoolDb ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__tagpoolDb = db;
}

export function describeDatabase(): string {
  if (!DATABASE_URL) return `PGlite (embedded) at ${PGLITE_DIR}`;
  try {
    const u = new URL(DATABASE_URL);
    return `Postgres at ${u.host}${u.pathname}`;
  } catch {
    return "Postgres";
  }
}

export { schema };
