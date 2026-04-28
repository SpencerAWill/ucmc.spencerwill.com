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
 *   - submitPublicProfileFn — partial update of public profile fields
 *   - submitDetailsFn     — partial update of private detail fields
 *   - uploadAvatarFn      — store a new avatar image in R2 + DB
 *   - removeAvatarFn      — clear the caller's avatar
 *
 * Shared types (ConsumeMagicLinkResult, ProfileInput) are declared here
 * so actions and clients can both reference them without pulling any
 * runtime from `.server.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { isValidPhoneNumber } from "react-phone-number-input";
import { z } from "zod";

import type { Principal } from "#/features/auth/server/principal.server";
import type { EmailProof } from "#/features/auth/server/proof-cookie.server";
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
      await import("#/features/auth/server/magic-link-actions.server");
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
      await import("#/features/auth/server/magic-link-actions.server");
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
  async (): Promise<{
    principal: Principal | null;
    anonymousPermissions: string[];
  }> => {
    const { getSessionAction } =
      await import("#/features/auth/server/magic-link-actions.server");
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
      await import("#/features/auth/server/magic-link-actions.server");
    return getProofAction();
  },
);

export const signOutFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { signOutAction } =
      await import("#/features/auth/server/magic-link-actions.server");
    return signOutAction();
  },
);

export type Profile = typeof schema.profiles.$inferSelect;

export interface EmergencyContactRow {
  name: string;
  phone: string;
  relationship: schema.ContactRelationship;
}

/**
 * Read the current user's profile row, if any. Returns `{ profile: null }`
 * for anonymous callers or users who haven't completed registration. Used
 * by `/account` to pre-fill the profile form with existing values.
 */
export const getProfileFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    profile: Profile | null;
    emergencyContacts: EmergencyContactRow[];
  }> => {
    const { getProfileAction } =
      await import("#/features/auth/server/magic-link-actions.server");
    return getProfileAction();
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

export const BIO_LIMITS = { maxWords: 150 } as const;

/**
 * Word count for bio validation + the live counter in the editor.
 * Empty / whitespace-only → 0. Mirrored on both server (zod refine)
 * and client (display) so the count never disagrees with the rule.
 */
export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

const phoneSchema = z
  .string()
  .trim()
  .refine(
    (v) => v.length > 0 && isValidPhoneNumber(v),
    "Enter a valid phone number",
  );

export const emergencyContactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(PROFILE_LIMITS.emergencyContactName.min, "Required")
    .max(
      PROFILE_LIMITS.emergencyContactName.max,
      `At most ${PROFILE_LIMITS.emergencyContactName.max} characters`,
    ),
  phone: phoneSchema,
  relationship: z.enum(schema.contactRelationship, {
    error: "Required",
  }),
});

export type EmergencyContactInput = z.infer<typeof emergencyContactSchema>;

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
  emergencyContacts: z.array(emergencyContactSchema),
  ucAffiliation: z.enum(schema.ucAffiliation, {
    error: "Required",
  }),
  bio: z
    .string()
    .trim()
    .refine((v) => countWords(v) <= BIO_LIMITS.maxWords, {
      message: `At most ${BIO_LIMITS.maxWords} words`,
    }),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

// Narrower schemas for the split account UI: `/account` (Profile tab)
// edits the public-ish fields, `/account/details` (Details tab) edits the
// PII fields + emergency contacts. Registration still uses the full
// `profileInputSchema` for its single onboarding submit.
export const publicProfileInputSchema = profileInputSchema.pick({
  preferredName: true,
  ucAffiliation: true,
  bio: true,
});

export type PublicProfileInput = z.infer<typeof publicProfileInputSchema>;

export const detailsInputSchema = profileInputSchema.pick({
  fullName: true,
  mNumber: true,
  phone: true,
  emergencyContacts: true,
});

export type DetailsInput = z.infer<typeof detailsInputSchema>;

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
      await import("#/features/auth/server/magic-link-actions.server");
    return submitProfileAction(data);
  });

/**
 * Partial update for the Profile tab. Writes preferredName + ucAffiliation
 * onto the caller's existing profile row. Requires an authenticated
 * principal (the route guard already enforces `requireApproved`); does
 * not touch the user row, status, or emergency contacts.
 */
export const submitPublicProfileFn = createServerFn({ method: "POST" })
  .inputValidator(publicProfileInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { submitPublicProfileAction } =
      await import("#/features/auth/server/magic-link-actions.server");
    return submitPublicProfileAction(data);
  });

/**
 * Partial update for the Details tab. Writes fullName + mNumber + phone
 * onto the caller's existing profile row and replaces the emergency
 * contact set. Requires an authenticated principal.
 */
export const submitDetailsFn = createServerFn({ method: "POST" })
  .inputValidator(detailsInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { submitDetailsAction } =
      await import("#/features/auth/server/magic-link-actions.server");
    return submitDetailsAction(data);
  });

// ── avatar upload / remove ──────────────────────────────────────────────

// `data:` URL for the cropped + compressed avatar. Length cap (~280 KB
// of base64) leaves headroom over the 200 KB raw-byte ceiling enforced
// inside the action.
export const avatarUploadInputSchema = z.object({
  dataUrl: z
    .string()
    .regex(/^data:image\/(?:webp|jpeg|png);base64,/, {
      message: "Avatar must be a webp, jpeg, or png data URL",
    })
    .max(280_000),
});

export type AvatarUploadInput = z.infer<typeof avatarUploadInputSchema>;

/**
 * Upload (or replace) the caller's avatar. Stores a normalized image
 * in R2 keyed by content hash, updates the profile row, and deletes
 * the previous R2 object on replacement.
 */
export const uploadAvatarFn = createServerFn({ method: "POST" })
  .inputValidator(avatarUploadInputSchema)
  .handler(async ({ data }): Promise<{ ok: true; avatarKey: string }> => {
    const { uploadAvatarAction } =
      await import("#/features/auth/server/avatar-actions.server");
    return uploadAvatarAction(data);
  });

/**
 * Clear the caller's avatar. Nulls the `avatar_key` column and deletes
 * the R2 object if one was set.
 */
export const removeAvatarFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { removeAvatarAction } =
      await import("#/features/auth/server/avatar-actions.server");
    return removeAvatarAction();
  },
);
