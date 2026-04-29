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

import { env } from "#/server/cloudflare-env";
import { getDb } from "#/server/db";
import { getKv } from "#/server/kv";
import { getBucket } from "#/server/r2";
import { checkHealthRateLimit } from "#/server/rate-limit.server";

import type { HealthCheck, HealthReport } from "#/server/health";

const EMAIL_PROBE_TIMEOUT_MS = 3000;

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

async function checkEmail(): Promise<HealthCheck> {
  const time = new Date().toISOString();

  // Mirrors the tier order in `server/email/resend.ts` so /health reports
  // which provider sendEmail() would actually use right now.
  if (env.RESEND_API_KEY) {
    try {
      // Probe via POST /emails with an empty body. The keys we mint per
      // stack are `sending_access`-scoped and Resend returns
      // `401 restricted_api_key` ("This API key is restricted to only
      // send emails") when those keys hit admin endpoints like
      // GET /domains, so we can't probe there. POST /emails always runs
      // auth+scope before validation, so a valid sending key returns
      // `400 validation_error` or `422 missing_required_field` for an
      // empty body — those become the pass signal. A revoked or
      // malformed key returns `403 invalid_api_key` or
      // `401 missing_api_key`, and Resend outages return 5xx; any of
      // those (or a thrown fetch) become the fail signal. Validation
      // errors do not consume sending quota.
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(EMAIL_PROBE_TIMEOUT_MS),
      });
      if (res.status === 400 || res.status === 422) {
        return { name: "email:resend", status: "pass", time };
      }
      return {
        name: "email:resend",
        status: "fail",
        time,
        output: `resend api returned ${res.status}`,
      };
    } catch {
      return {
        name: "email:resend",
        status: "fail",
        time,
        output: "resend api unreachable",
      };
    }
  }

  if (env.MAILPIT_URL) {
    try {
      const res = await fetch(`${env.MAILPIT_URL}/api/v1/info`, {
        method: "GET",
        signal: AbortSignal.timeout(EMAIL_PROBE_TIMEOUT_MS),
      });
      if (!res.ok) {
        return {
          name: "email:mailpit",
          status: "fail",
          time,
          output: `mailpit returned ${res.status}`,
        };
      }
      return { name: "email:mailpit", status: "pass", time };
    } catch {
      return {
        name: "email:mailpit",
        status: "fail",
        time,
        output: "mailpit unreachable",
      };
    }
  }

  // No provider configured — sendEmail() falls back to console.log. Not a
  // failure, but worth surfacing so it's obvious why no mail is going out.
  return {
    name: "email:console",
    status: "pass",
    time,
    output: "console fallback (no email provider configured)",
  };
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
  const checks = await Promise.all([
    checkD1(),
    checkR2(),
    checkKv(),
    checkEmail(),
  ]);
  const status = checks.every((c) => c.status === "pass") ? "pass" : "fail";
  return { status, checks };
}
