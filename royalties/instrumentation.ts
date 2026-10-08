/** Applies the schema at boot, so deploying is just "push the code". */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("./lib/db/migrate");
  const { describeDatabase } = await import("./lib/db");

  try {
    await runMigrations();
    console.log(`[royalties] schema ready — ${describeDatabase()}`);
  } catch (error) {
    console.error("[royalties] migration failed at startup:", error);
    throw error;
  }
}
