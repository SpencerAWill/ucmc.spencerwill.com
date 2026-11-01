import { getRequestHeader } from "@tanstack/react-start/server";
import { and, count, eq, gt } from "drizzle-orm";

import { env } from "#/server/cloudflare-env";
import { getDb, schema } from "#/server/db";
import { serverEnv } from "#/server/env.server";

/**
 * E2e-only escape hatch. When `E2E_BYPASS_RATE_LIMIT=1` is set on the
 * Worker env, every limiter check short-circuits to "allowed". Set by
 * Playwright's webServer config because the suite hits 6+ auth endpoints
 * per run and the 10 req/60 s budget would trip mid-run on a reused dev
 * server. Production envs MUST NEVER set this.
 */
function isBypassed(): boolean {
  return serverEnv().E2E_BYPASS_RATE_LIMIT === "1";
}

/**
 * Checks the /health rate-limiter binding for the caller's IP. Returns
 * `true` when the request is within budget, `false` when it should be
 * degraded or refused.
 *
 * Key is `CF-Connecting-IP` — set by Cloudflare at the edge on every
 * real request, and always accurate (cannot be spoofed like
 * `X-Forwarded-For`). Locally (Miniflare) the header is absent; we fall
 * back to a single `"local"` bucket so dev traffic still exercises the
 * binding rather than silently bypassing it.
 *
 * Never throws — a broken binding must not take the health page down
 * (which would defeat the purpose). On error we fail *open* (allow), on
 * the theory that losing rate-limit protection is less bad than the
 * health page 500ing.
 */
export async function checkHealthRateLimit(): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const key = getRequestHeader("cf-connecting-ip") ?? "local";
    const { success } = await env.HEALTH_RATE_LIMITER.limit({ key });
    return success;
  } catch {
    return true;
  }
}

/**
 * Client IP for auth rate-limit keys. Same Cloudflare-authoritative
 * header as the health limiter; falls back to "local" under Miniflare.
 */
function clientIp(): string {
  return getRequestHeader("cf-connecting-ip") ?? "local";
}

/**
 * Gate an auth operation by IP. Call at the TOP of magic-link request,
 * magic-link consume, and passkey finish handlers — before any D1/KV
 * work — so a flood can't amplify into storage calls. Passkey *begin*
 * uses `checkCeremonyRateLimitByIp` instead (#306).
 *
 * Returns true to allow the request; false to refuse it. Fails open on
 * binding error (same reasoning as `checkHealthRateLimit`).
 */
export async function checkAuthRateLimitByIp(): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const { success } = await env.AUTH_RATE_LIMITER.limit({
      key: `ip:${clientIp()}`,
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * Gate the begin half of a passkey ceremony (register or authenticate)
 * by IP, on its own budget.
 *
 * Passkey autofill starts an authenticate ceremony on every `/sign-in`
 * load, before the visitor touches anything. On `AUTH_RATE_LIMITER` that
 * spent the budget the magic-link request and consume check, so on a
 * shared campus IP a visitor could be told to "check your email" for a
 * link that was never sent (#306). Begin writes nothing — the ceremony
 * travels in a signed cookie — so a looser separate budget only has to
 * stop a flood of signing work. Finish verifies a credential and writes
 * the single-use marker, so it stays on `checkAuthRateLimitByIp`.
 *
 * Fails open on binding error, like every other limiter here.
 */
export async function checkCeremonyRateLimitByIp(): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const { success } = await env.CEREMONY_RATE_LIMITER.limit({
      key: `ip:${clientIp()}`,
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * Gate an auth operation by email. Layered on top of the IP limiter so
 * one attacker can't enumerate by rotating IPs through a residential
 * proxy pool: even with infinite IPs, the per-email budget bites. Caller
 * must normalize the email (lowercase/trim) before keying.
 */
export async function checkAuthRateLimitByEmail(
  normalizedEmail: string,
): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const { success } = await env.AUTH_RATE_LIMITER.limit({
      key: `email:${normalizedEmail}`,
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * Gate an avatar upload by user. Keyed by the signed-in user's id so
 * one account can't burn R2 PUTs by replaying the form. Fails open on
 * binding error.
 */
export async function checkUploadRateLimit(userId: string): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const { success } = await env.UPLOAD_RATE_LIMITER.limit({
      key: `user:${userId}`,
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * Gate a feedback submission by user. Reuses the AUTH_RATE_LIMITER
 * binding under a distinct key namespace (`feedback:user:<id>`, unchanged
 * by the site-feedback rename so live counters survive the deploy) — the
 * limiter counts per key, so this does not contend with auth-flow keys.
 * The 10 req/60 s budget is far more than legitimate feedback usage and
 * cheaper than provisioning a fourth binding. Fails open on binding
 * error so a broken limiter doesn't block submissions.
 */
export async function checkSiteFeedbackRateLimit(
  userId: string,
): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const { success } = await env.AUTH_RATE_LIMITER.limit({
      key: `feedback:user:${userId}`,
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * Parallel to `checkSiteFeedbackRateLimit` for the club-feedback surface.
 * Distinct key namespace (`club_feedback:user:<id>`) so the site
 * + club budgets are independent — a member burning their site
 * budget shouldn't lock them out of submitting governance feedback,
 * and vice versa. Same 10 req/60 s envelope as the site surface;
 * same fail-open contract.
 */
export async function checkClubFeedbackRateLimit(
  userId: string,
): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const { success } = await env.AUTH_RATE_LIMITER.limit({
      key: `club_feedback:user:${userId}`,
    });
    return success;
  } catch {
    return true;
  }
}

/**
 * Gate a calendar feed fetch.
 *
 * Keyed by the subscription token, or by IP for the public feed —
 * those are the only identities an unauthenticated poll carries. This
 * is the one rate-limited surface with no session at all, which is
 * precisely why it has its own budget rather than sharing one with a
 * signed-in endpoint: a scraper walking token space must not be able to
 * exhaust anything a member needs.
 *
 * Fails open on binding error, like every other limiter here.
 */
export async function checkCalendarFeedRateLimit(
  key: string,
): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const { success } = await env.CALENDAR_RATE_LIMITER.limit({ key });
    return success;
  } catch {
    return true;
  }
}

/** Conduct reports one member may file in `CONDUCT_REPORT_WINDOW_MS`. */
const CONDUCT_REPORT_LIMIT = 5;
const CONDUCT_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Gate a conduct report by reporter: at most 5 in any 24 hours.
 *
 * Unlike the limiters above this counts the reporter's own rows in
 * `conduct_reports` rather than calling a rate-limit binding, because a
 * binding's `period` is 10 or 60 s only (`docs/platform-limits.md`) and
 * a day-long budget is the point here. The count is exact and global,
 * not per location. Two submissions racing past the count can both land,
 * which is fine for a speed bump against a flood of reports.
 *
 * The window is exact elapsed time, not calendar days. Fails open on a
 * D1 error, like every other limiter here; the insert that follows would
 * fail on the same error anyway.
 */
export async function checkConductReportRateLimit(
  userId: string,
): Promise<boolean> {
  if (isBypassed()) {
    return true;
  }
  try {
    const since = Temporal.Now.instant().subtract({
      milliseconds: CONDUCT_REPORT_WINDOW_MS,
    });
    const [row] = await getDb()
      .select({ n: count() })
      .from(schema.conductReports)
      .where(
        and(
          eq(schema.conductReports.reporterUserId, userId),
          gt(schema.conductReports.createdAt, since),
        ),
      );
    return row.n < CONDUCT_REPORT_LIMIT;
  } catch {
    return true;
  }
}
