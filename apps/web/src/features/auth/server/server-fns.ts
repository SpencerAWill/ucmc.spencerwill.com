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
import { z } from "zod";

import {
  detailsInputSchema,
  profileInputSchema,
  publicProfileInputSchema,
} from "#/server/profile/profile-schemas";
import type { Principal } from "#/server/auth/principal.server";
import type { EmailProof } from "#/server/auth/proof-cookie.server";
import type { schema } from "#/server/db";

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
// Schemas/constants/types are shared with features/members and live in
// `#/server/profile/profile-schemas`. Re-exported here for now-existing
// downstream importers; the canonical location is the schemas module.

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
 * Partial update for the Details tab. Writes fullName + phone onto the
 * caller's existing profile row and replaces the emergency contact set.
 * Requires an authenticated principal.
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
