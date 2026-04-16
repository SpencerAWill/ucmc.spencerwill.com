/**
 * TanStack Start server functions for the magic-link flow.
 *
 * Scope of this phase:
 *   - requestMagicLinkFn — issue a link for a given email, auto-detecting
 *     register vs login intent. Enumeration-proof: always resolves
 *     `{ ok: true }`, even when rate-limited or when the email has never
 *     been seen (the caller cannot tell the difference).
 *   - consumeMagicLinkFn — verify a token and, on success, write the
 *     short-lived email-verified proof cookie. Deliberately does NOT open
 *     a session or touch the users table. User creation / session opening
 *     lives in Phase 4d (profile submit) and Phase 5 (existing-user
 *     sign-in), respectively.
 */
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { consumeMagicLink, requestMagicLink } from "#/server/auth/magic-link";
import { writeProofCookie } from "#/server/auth/proof-cookie";
import { getDb, schema } from "#/server/db";
import {
  checkAuthRateLimitByEmail,
  checkAuthRateLimitByIp,
} from "#/server/rate-limit";

// Matches the RFC 5321 local-part-plus-domain max length. Trimming and
// lowercasing here keeps the same email canonical everywhere downstream
// (D1 rows, proof cookie, rate-limit key).
const emailSchema = z.email().trim().toLowerCase().max(254);

export const requestMagicLinkFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: emailSchema }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    // Both rate-limit checks silently short-circuit to the success shape
    // so the client can't distinguish rate-limited vs honored vs unknown
    // email. Timing jitter (added in Phase 10) will flatten the remaining
    // latency signal.
    if (!(await checkAuthRateLimitByIp())) {
      return { ok: true };
    }
    if (!(await checkAuthRateLimitByEmail(data.email))) {
      return { ok: true };
    }

    const existing = await getDb().query.users.findFirst({
      where: eq(schema.users.email, data.email),
      columns: { id: true },
    });

    await requestMagicLink({
      email: data.email,
      intent: existing ? "login" : "register",
    });

    return { ok: true };
  });

type ConsumeResult =
  | { ok: true; intent: schema.MagicLinkIntent }
  | { ok: false; reason: "invalid" | "rate_limited" };

export const consumeMagicLinkFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      // Tokens are base64url(32 random bytes) → 43 chars. Bounds are
      // generous for headroom; the hash check inside `consumeMagicLink`
      // is the real gate.
      token: z.string().min(16).max(128),
    }),
  )
  .handler(async ({ data }): Promise<ConsumeResult> => {
    if (!(await checkAuthRateLimitByIp())) {
      return { ok: false, reason: "rate_limited" };
    }

    const proof = await consumeMagicLink(data.token);
    if (!proof) {
      return { ok: false, reason: "invalid" };
    }

    await writeProofCookie({
      email: proof.email,
      intent: proof.intent,
      issuedAt: Date.now(),
    });

    return { ok: true, intent: proof.intent };
  });
