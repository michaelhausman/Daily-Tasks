/**
 * Runs once when the server process starts.
 *
 * Applying the schema here means deploying is just "push the code" — there is
 * no separate migrate step to remember, no shell to open on the host, and no
 * window where the app is live against a database that has no tables. The DDL
 * is idempotent (every statement is guarded), so booting repeatedly is safe.
 */
export async function register() {
  // instrumentation also loads in the edge runtime, where pg and PGlite can't.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("./lib/db/migrate");
  const { describeDatabase } = await import("./lib/db");

  try {
    await runMigrations();
    console.log(`[tagpool] schema ready — ${describeDatabase()}`);
  } catch (error) {
    // Deliberately fatal. A server that starts without its schema serves
    // nothing but 500s, and failing loudly at boot is far easier to diagnose
    // from a deploy log than a stream of runtime errors later.
    console.error("[tagpool] migration failed at startup:", error);
    throw error;
  }
}
