import { randomBytes } from "node:crypto";

/**
 * Kept free of Next-specific imports so scripts (migrate, seed) can use it
 * without pulling `next/headers` into a plain Node process.
 */
export function newId(): string {
  return randomBytes(16).toString("hex");
}
