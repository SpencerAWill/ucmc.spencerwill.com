/**
 * Route-facing shells for the magic-link / session / profile server fns.
 * Each handler dynamic-imports its implementation from
 * `./magic-link-actions.server` — the TanStack Start compiler replaces
 * handler bodies with RPC stubs in the client bundle, so the real code
 * path never reaches the browser. Module-scope imports here are limited
 * to client-safe things: createServerFn, zod, a value-only `schema`
 * namespace for zod enums, and `import type` across server-only
 * boundaries.
 *
 * Exports:
 *   - requestMagicLinkFn  — enumeration-proof token issuance
 *   - consumeMagicLinkFn  — single-use token redemption + session open
 *   - getSessionFn        — current principal for the root loader
 *   - getProofFn          — short-lived email-verified proof cookie
 *   - signOutFn           — close current session
 *   - submitProfileFn     — create/update profile, upsert user row
 *
 * Shared types (ConsumeMagicLinkResult, ProfileInput) are declared here
 * so actions and clients can both reference them without pulling any
 * runtime from `.server.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { isValidPhoneNumber } from "react-phone-number-input";
import { z } from "zod";

import type { Principal } from "#/server/auth/principal.server";
import type { EmailProof } from "#/server/auth/proof-cookie.server";
import { schema } from "#/server/db";

// ── types shared with magic-link-actions.server.ts ───────────────────────

export type ConsumeMagicLinkResult =
  | {
      ok: true;
      mode: "session";
      status: schema.UserStatus;
      hasProfile: boolean;
    }
  | { ok: true; mode: "proof"; intent: schema.MagicLinkIntent }
  | { ok: false; reason: "invalid" | "rate_limited" };

// ── request / consume ────────────────────────────────────────────────────

// Matches the RFC 5321 local-part-plus-domain max length. Trimming and
// lowercasing here keeps the same email canonical everywhere downstream
// (D1 rows, proof cookie, rate-limit key).
const emailSchema = z.email().trim().toLowerCase().max(254);

export const requestMagicLinkFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: emailSchema,
      // Turnstile challenge token. Empty string when the widget isn't
      // rendered (local dev without VITE_TURNSTILE_SITE_KEY). The
      // server skips verification when TURNSTILE_SECRET_KEY is unset.
      turnstileToken: z.string().default(""),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requestMagicLinkAction } =
      await import("#/server/auth/magic-link-actions.server");
    return requestMagicLinkAction({
      email: data.email,
      turnstileToken: data.turnstileToken,
    });
  });

export const consumeMagicLinkFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      // Tokens are base64url(32 random bytes) → 43 chars. Bounds are
      // generous for headroom; the hash check inside `consumeMagicLink`
      // is the real gate.
      token: z.string().min(16).max(128),
    }),
  )
  .handler(async ({ data }): Promise<ConsumeMagicLinkResult> => {
    const { consumeMagicLinkAction } =
      await import("#/server/auth/magic-link-actions.server");
    return consumeMagicLinkAction(data.token);
  });

// ── principal / proof / sign-out ─────────────────────────────────────────

/**
 * Read the current session's principal. Called on every navigation via the
 * root loader so the client-side `useAuth()` hook has a fresh value
 * without its own fetch. GET + null on anonymous so SSR can always
 * render something and hydration matches.
 */
export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ principal: Principal | null }> => {
    const { getSessionAction } =
      await import("#/server/auth/magic-link-actions.server");
    return getSessionAction();
  },
);

/**
 * Read the email-verified proof cookie, if any. Used by routes that gate
 * on "magic link was clicked" rather than "user is signed in" —
 * specifically `/register/profile`.
 */
export const getProofFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ proof: EmailProof | null }> => {
    const { getProofAction } =
      await import("#/server/auth/magic-link-actions.server");
    return getProofAction();
  },
);

export const signOutFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { signOutAction } =
      await import("#/server/auth/magic-link-actions.server");
    return signOutAction();
  },
);

// ── profile submission ───────────────────────────────────────────────────

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

export type ProfileInput = z.infer<typeof profileInputSchema>;

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
    const { submitProfileAction } =
      await import("#/server/auth/magic-link-actions.server");
    return submitProfileAction(data);
  });
