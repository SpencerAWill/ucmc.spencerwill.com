/**
 * Health-probe implementation. Imported dynamically from the `checkHealth`
 * server-fn handler in `./health.ts` so the module-scope imports of D1,
 * R2, KV, and the rate-limit binding stay off the client bundle graph.
 *
 * Each probe MUST NOT throw — failures are returned as `status: "fail"` so
 * /health can render them inline. The overall report is `pass` only if
 * every probe passes.
 */
import { sql } from "drizzle-orm";

import { getDb } from "#/server/db";
import { getKv } from "#/server/kv";
import { getBucket } from "#/server/r2";
import { checkHealthRateLimit } from "#/server/rate-limit.server";

import type { HealthCheck, HealthReport } from "#/server/health";

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

async function checkKv(): Promise<HealthCheck> {
  const time = new Date().toISOString();
  try {
    const kv = getKv();
    // `get` on a missing key returns null — success on an empty namespace.
    // Only throws when the binding itself is broken. O(1), no seed key
    // required.
    await kv.get("__healthcheck__");
    return { name: "kv:read", status: "pass", time };
  } catch {
    return {
      name: "kv:read",
      status: "fail",
      time,
      output: "kv namespace unreachable",
    };
  }
}

export async function performHealthChecks(): Promise<HealthReport> {
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
  const checks = await Promise.all([checkD1(), checkR2(), checkKv()]);
  const status = checks.every((c) => c.status === "pass") ? "pass" : "fail";
  return { status, checks };
}
