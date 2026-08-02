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
  /**
   * Never fall back to the embedded database in production.
   *
   * PGlite is a whole Postgres compiled to WebAssembly living in the app's own
   * memory: ~550MB resident versus ~85MB when talking to a real server. On a
   * small container that difference is the gap between running and being
   * OOM-killed, and because the fallback was silent the symptom was a crash
   * loop with no hint that a database URL was missing.
   *
   * It is also simply wrong to serve real traffic from a database stored in a
   * container's filesystem, which is discarded on every deploy.
   */
  if (process.env.NODE_ENV === "production" && !DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set.\n\n" +
        "In production Tagpool needs a real Postgres server. On Railway, add a " +
        "Postgres service and then add a variable to THIS service:\n\n" +
        "    DATABASE_URL=${{Postgres.DATABASE_URL}}\n\n" +
        "Adding the database alone does not connect it — the reference is what " +
        "wires the two together. See DEPLOY.md.",
    );
  }

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
  warnIfPgliteAlreadyOpen();
  return drizzlePglite(new PGlite(PGLITE_DIR), { schema });
}

// Next's dev server re-evaluates modules on every hot reload; without this the
// process accumulates connection pools until Postgres refuses new clients.
const globalForDb = globalThis as unknown as {
  __tagpoolDb?: ReturnType<typeof createClient>;
};

type Client = ReturnType<typeof createClient>;

function getClient(): Client {
  if (!globalForDb.__tagpoolDb) {
    globalForDb.__tagpoolDb = createClient();
  }
  return globalForDb.__tagpoolDb;
}

/**
 * Connected lazily, on first query rather than on import.
 *
 * `next build` imports every route module to analyse it. Creating the client at
 * module scope meant the *build* opened a database — spinning up PGlite and
 * writing a data directory inside the build container, or constructing a pool
 * against a server that may not be reachable from a builder at all. Neither is
 * something a build should be doing, and it's an unnecessary way for a deploy
 * to fail before the app has even started.
 *
 * The proxy keeps the ergonomics identical: callers still `import { db }` and
 * call methods on it, and nothing happens until one of them actually runs.
 */
export const db = new Proxy({} as Client, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, prop) {
    return Reflect.has(getClient() as object, prop);
  },
});

/**
 * PGlite is an in-process database: each process that opens the directory gets
 * its own independent copy, and they overwrite each other on flush. So running
 * `npm run seed` while `npm run dev` is up doesn't share data — it silently
 * loses it, which is a miserable thing to debug.
 *
 * A real Postgres server has no such limitation, so this only applies locally.
 * It warns rather than throws: a stale lock from a crashed process should never
 * be the reason someone can't start their app.
 */
function warnIfPgliteAlreadyOpen(): void {
  const lockPath = path.join(path.dirname(PGLITE_DIR), "pglite.lock");

  try {
    const existing = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (existing && existing !== process.pid) {
      let alive = false;
      try {
        // Signal 0 tests for existence without actually signalling.
        process.kill(existing, 0);
        alive = true;
      } catch {
        alive = false; // stale lock from a process that already exited
      }

      if (alive) {
        console.warn(
          `\n[tagpool] WARNING: another process (pid ${existing}) already has the local database open.` +
            `\n          PGlite is single-process — both copies will overwrite each other.` +
            `\n          Stop the dev server before running scripts, or set DATABASE_URL` +
            `\n          to a real Postgres server to work on both at once.\n`,
        );
      }
    }
  } catch {
    // No lock file yet, or it's unreadable. Either way, carry on.
  }

  try {
    fs.writeFileSync(lockPath, String(process.pid));
  } catch {
    // A read-only filesystem shouldn't stop the app from running.
  }
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
