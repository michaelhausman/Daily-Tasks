import { describeDatabase } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";

runMigrations()
  .then(() => {
    console.log(`Schema is up to date — ${describeDatabase()}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
