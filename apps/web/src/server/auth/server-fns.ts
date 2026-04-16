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
import { isValidPhoneNumber } from "react-phone-number-input";
import { z } from "zod";

import { consumeMagicLink, requestMagicLink } from "#/server/auth/magic-link";
import type { Principal } from "#/server/auth/principal";
import {
  clearProofCookie,
  readProofCookie,
  writeProofCookie,
} from "#/server/auth/proof-cookie";
import type { EmailProof } from "#/server/auth/proof-cookie";
import {
  closeSession,
  loadCurrentPrincipal,
  openSession,
} from "#/server/auth/session";
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

/**
 * Read the current session's principal. Called on every navigation via the
 * root loader so the client-side `useAuth()` hook has a fresh value
 * without its own fetch. GET + null on anonymous so SSR can always
 * render something and hydration matches.
 */
export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ principal: Principal | null }> => {
    const principal = await loadCurrentPrincipal();
    return { principal };
  },
);

/**
 * Read the email-verified proof cookie, if any. Used by routes that gate
 * on "magic link was clicked" rather than "user is signed in" —
 * specifically `/register/profile`.
 */
export const getProofFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ proof: EmailProof | null }> => {
    const proof = await readProofCookie();
    return { proof };
  },
);

export const signOutFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    await closeSession();
    return { ok: true };
  },
);

// ── profile submission ────────────────────────────────────────────────────

// Validation constants are exported so the form UI can mirror them as
// HTML `maxLength` attributes and help text (single source of truth).
export const PROFILE_LIMITS = {
  fullName: { min: 1, max: 120 },
  preferredName: { min: 1, max: 60 },
  emergencyContactName: { min: 1, max: 120 },
} as const;

const phoneSchema = z
  .string()
  .trim()
  .refine(
    (v) => v.length > 0 && isValidPhoneNumber(v),
    "Enter a valid phone number",
  );

export const profileInputSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(PROFILE_LIMITS.fullName.min, "Required")
    .max(
      PROFILE_LIMITS.fullName.max,
      `At most ${PROFILE_LIMITS.fullName.max} characters`,
    ),
  preferredName: z
    .string()
    .trim()
    .min(PROFILE_LIMITS.preferredName.min, "Required")
    .max(
      PROFILE_LIMITS.preferredName.max,
      `At most ${PROFILE_LIMITS.preferredName.max} characters`,
    ),
  // Optional: not every member has a UC M-number (alumni, community,
  // some family members). Empty string passes; anything else must match
  // the full `M########` format.
  mNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^$|^M\d{8}$/, "Must be 'M' followed by 8 digits"),
  phone: phoneSchema,
  emergencyContactName: z
    .string()
    .trim()
    .min(PROFILE_LIMITS.emergencyContactName.min, "Required")
    .max(
      PROFILE_LIMITS.emergencyContactName.max,
      `At most ${PROFILE_LIMITS.emergencyContactName.max} characters`,
    ),
  emergencyContactPhone: phoneSchema,
  ucAffiliation: z.enum(schema.ucAffiliation, {
    error: "Required",
  }),
});

/**
 * First-time profile submission. Callable by a user who has a valid
 * email-verified proof cookie but no session yet (the register flow) OR
 * by an already-signed-in user updating their profile (the re-submit
 * flow in Phase 6+).
 *
 * On success:
 *   - users row is upserted by email (pre-seeded row wins if present;
 *     otherwise a fresh row is inserted with status='pending').
 *   - profiles row is upserted with the submitted data.
 *   - if the caller only had a proof cookie, we open a session for
 *     them and clear the proof. Already-signed-in callers keep their
 *     existing session.
 *   - status stays 'pending' unless already 'approved' (profile edits
 *     never downgrade; only an approver can promote).
 */
export const submitProfileFn = createServerFn({ method: "POST" })
  .inputValidator(profileInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const principal = await loadCurrentPrincipal();
    const proof = principal ? null : await readProofCookie();

    if (!principal && !proof) {
      throw new Error("Not authorized to submit a profile");
    }

    const email = principal?.email ?? proof!.email;

    // Find or create the user row. Pre-seeded rows (email-only, no profile)
    // are reused by hitting the unique email index. We do this in three
    // steps — insert-on-conflict-do-nothing, then select — to stay portable
    // across D1's SQLite dialect without depending on `returning`.
    const id = `user_${crypto.randomUUID()}`;
    await getDb()
      .insert(schema.users)
      .values({ id, email, status: "pending" })
      .onConflictDoNothing({ target: schema.users.email });
    const userRow = await getDb().query.users.findFirst({
      where: eq(schema.users.email, email),
    });
    if (!userRow) {
      throw new Error("User row not found after upsert (unexpected)");
    }

    const now = new Date();
    await getDb()
      .insert(schema.profiles)
      .values({ userId: userRow.id, ...data, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.profiles.userId,
        set: { ...data, updatedAt: now },
      });

    if (userRow.status !== "approved") {
      await getDb()
        .update(schema.users)
        .set({ status: "pending" })
        .where(eq(schema.users.id, userRow.id));
    }

    if (!principal) {
      await openSession(userRow.id);
      clearProofCookie();
    }

    return { ok: true };
  });
