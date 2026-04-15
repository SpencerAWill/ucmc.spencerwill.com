import { createServerFn } from "@tanstack/react-start";
import { sql } from "drizzle-orm";

import { getDb } from "#/server/db";

/**
 * Runs a no-op `SELECT 1` against D1 to prove the binding resolves, the
 * worker can reach the DB, and Drizzle can build queries.
 *
 * Kept in its own server module (rather than inline in the route file)
 * because TanStack Start's route-splitting re-emits the route file into
 * client chunks. Keeping the D1 import chain behind the server-fn boundary
 * makes sure client bundles never try to resolve `cloudflare:workers`.
 *
 * Never throws — failures are returned as `status: "fail"` so the caller
 * can render them inline instead of tripping an error boundary.
 */
export const checkHealth = createServerFn({ method: "GET" }).handler(
  async () => {
    const time = new Date().toISOString();
    try {
      const db = getDb();
      await db.run(sql`SELECT 1`);
      return { status: "pass" as const, check: { name: "d1:read", time } };
    } catch {
      return {
        status: "fail" as const,
        check: { name: "d1:read", time, output: "database unreachable" },
      };
    }
  },
);
