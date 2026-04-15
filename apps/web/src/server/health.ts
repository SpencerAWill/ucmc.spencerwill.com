import { createServerFn } from "@tanstack/react-start";
import { sql } from "drizzle-orm";

import { getDb } from "#/server/db";
import { getBucket } from "#/server/r2";
import { checkHealthRateLimit } from "#/server/rate-limit";

/**
 * Per-check shape. `output` is set only on failure so the client can render
 * an inline error message without tripping an error boundary.
 */
export interface HealthCheck {
  name: string;
  status: "pass" | "fail";
  time: string;
  output?: string;
}

export interface HealthReport {
  status: "pass" | "fail";
  checks: HealthCheck[];
}

/**
 * Individual probes live in their own module rather than inline in the route
 * file because TanStack Start's route-splitting re-emits route files into
 * client chunks. Keeping the D1/R2 import chains behind the server-fn
 * boundary makes sure client bundles never try to resolve
 * `cloudflare:workers`.
 *
 * Each probe MUST NOT throw — failures are returned as `status: "fail"` so
 * /health can render them inline. The overall report is `pass` only if
 * every probe passes.
 */

async function checkD1(): Promise<HealthCheck> {
  const time = new Date().toISOString();
  try {
    const db = getDb();
    await db.run(sql`SELECT 1`);
    return { name: "d1:read", status: "pass", time };
  } catch {
    return {
      name: "d1:read",
      status: "fail",
      time,
      output: "database unreachable",
    };
  }
}

async function checkR2(): Promise<HealthCheck> {
  const time = new Date().toISOString();
  try {
    const bucket = getBucket();
    // `head` on a missing key returns null (not an error), so this succeeds
    // on an empty bucket. It only throws when the binding itself is broken
    // or credentials can't reach R2. O(1), no seed object required.
    await bucket.head("__healthcheck__");
    return { name: "r2:head", status: "pass", time };
  } catch {
    return {
      name: "r2:head",
      status: "fail",
      time,
      output: "bucket unreachable",
    };
  }
}

export const checkHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<HealthReport> => {
    // Rate-limit check first — short-circuits BEFORE touching D1/R2, which
    // is the point: a flood of /health hits should not amplify into D1
    // reads and R2 HEAD calls. 20 req / 60s per IP (see wrangler.jsonc).
    const allowed = await checkHealthRateLimit();
    if (!allowed) {
      return {
        status: "fail",
        checks: [
          {
            name: "rate-limit",
            status: "fail",
            time: new Date().toISOString(),
            output: "too many requests — try again in a minute",
          },
        ],
      };
    }

    // Probes run in parallel — they're independent and the slowest one
    // dominates total latency of the /health page.
    const checks = await Promise.all([checkD1(), checkR2()]);
    const status = checks.every((c) => c.status === "pass") ? "pass" : "fail";
    return { status, checks };
  },
);
