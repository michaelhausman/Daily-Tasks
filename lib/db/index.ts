import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";

const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), ".data", "tagpool.db");

function createClient() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

// Next's dev server re-evaluates modules on every hot reload; without this the
// process accumulates SQLite handles until it runs out of file descriptors.
const globalForDb = globalThis as unknown as {
  __tagpoolDb?: ReturnType<typeof createClient>;
};

export const db = globalForDb.__tagpoolDb ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__tagpoolDb = db;
}

export { schema, DB_PATH };
