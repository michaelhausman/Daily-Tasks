import { DB_PATH } from "../lib/db";
import { runMigrations } from "../lib/db/migrate";

runMigrations();
console.log(`Schema is up to date at ${DB_PATH}`);
