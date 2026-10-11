/**
 * Profile validation: shared zod schemas, length limits, and the bio word
 * counter. Imported by:
 *   - features/auth: ProfileForm self-edit + the magic-link server-fns
 *     shell (submitProfileFn / submitPublicProfileFn / submitDetailsFn).
 *   - features/members: AdminProfileSheet + admin-side member-actions.
 *
 * Lives outside features/ because the contract is one-and-the-same
 * regardless of who's submitting; both paths must validate identically
 * or admin/self drift over time. Drizzle enums sit in `#/server/db`,
 * which is also feature-blind.
 */
import { isValidPhoneNumber } from "react-phone-number-input";
import { z } from "zod";
import {
  DISCIPLINE_KEYS,
  DISCIPLINE_LEVEL_KEYS,
  MAX_ANSWERED_PROMPTS,
  PROFILE_PROMPT_KEYS,
  PROMPT_ANSWER_MAX_LENGTH,
} from "#/server/member-profile/profile-prompt-registry";

import { schema } from "#/server/db";

/**
 * Validation constants exported so the form UI can mirror them as HTML
 * `maxLength` attributes and help text — single source of truth for
 * client + server.
 */
export const PROFILE_LIMITS = {
  fullName: { min: 1, max: 120 },
  preferredName: { min: 1, max: 60 },
  emergencyContactName: { min: 1, max: 120 },
  // The three optional identity fields (#257). Each is capped to
  // what the profile header can render on one phone line before it
  // wraps into the next element — these are one-liners by design,
  // and the bio is where anything longer belongs.
  trailName: { min: 0, max: 40 },
  pronouns: { min: 0, max: 30 },
  statusLine: { min: 0, max: 120 },
} as const;

export const BIO_LIMITS = { maxWords: 150 } as const;

/**
 * Word count for bio validation + the live counter in the editor.
 * Empty / whitespace-only → 0. Mirrored on both server (zod refine) and
 * client (display) so the count never disagrees with the rule.
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
  phone: phoneSchema,
  // A sanity bound, not a storage one: the contacts insert is split to
  // fit D1 at any length (#291). Ten is far past anyone's real list and
  // keeps one form submission from writing an unbounded number of rows.
  emergencyContacts: z.array(emergencyContactSchema).max(10),
  ucAffiliation: z.enum(schema.ucAffiliation, {
    error: "Required",
  }),
  bio: z
    .string()
    .trim()
    .refine((v) => countWords(v) <= BIO_LIMITS.maxWords, {
      message: `At most ${BIO_LIMITS.maxWords} words`,
    }),
  // All three optional: an empty string is valid and is stored as
  // NULL, so the header omits the line rather than rendering a gap.
  trailName: z
    .string()
    .trim()
    .max(
      PROFILE_LIMITS.trailName.max,
      `At most ${PROFILE_LIMITS.trailName.max} characters`,
    ),
  pronouns: z
    .string()
    .trim()
    .max(
      PROFILE_LIMITS.pronouns.max,
      `At most ${PROFILE_LIMITS.pronouns.max} characters`,
    ),
  statusLine: z
    .string()
    .trim()
    .max(
      PROFILE_LIMITS.statusLine.max,
      `At most ${PROFILE_LIMITS.statusLine.max} characters`,
    ),
  // Carried on the shape so non-registration forms (Profile, Details,
  // admin sheet) match the same validator. Accepts any boolean here;
  // the registration submit overrides this to literal-true via
  // `registrationInputSchema`. Subset schemas (`publicProfileInputSchema`,
  // `detailsInputSchema`) `.pick()` only the keys they want, so they
  // never read this field.
  policiesAck: z.boolean(),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

/**
 * Registration submit shape. Extends `profileInputSchema` with a
 * required acknowledgment of UCMC's anti-hazing + non-discrimination
 * policies — captured once at registration, re-prompted only when
 * `POLICIES_VERSION` is bumped (handled server-side, not in this
 * schema). The checkbox must be ticked; `z.literal(true)` rejects
 * unchecked submits with a clear message.
 */
export const registrationInputSchema = profileInputSchema.extend({
  policiesAck: z.literal(true, {
    error: "Please acknowledge the policies to continue",
  }),
});

export type RegistrationInput = z.infer<typeof registrationInputSchema>;

// Narrower schemas for the split account UI: `/account` (Profile tab)
// edits the public-ish fields, `/account/details` (Details tab) edits
// the PII fields + emergency contacts. Registration uses
// `registrationInputSchema` (above) which adds the policies ack.
export const publicProfileInputSchema = profileInputSchema.pick({
  preferredName: true,
  ucAffiliation: true,
  bio: true,
  trailName: true,
  pronouns: true,
  statusLine: true,
});

export type PublicProfileInput = z.infer<typeof publicProfileInputSchema>;

export const detailsInputSchema = profileInputSchema.pick({
  fullName: true,
  phone: true,
  emergencyContacts: true,
});

export type DetailsInput = z.infer<typeof detailsInputSchema>;

// ── Profile facets: prompt answers and self-rated disciplines ────────
//
// Deliberately NOT part of `profileInputSchema`. Those fields are all
// columns on `profiles` and one UPDATE writes them; these are rows in
// two other tables, written by their own action with its own Save.
// Folding them into the shared shape would also mean registration and
// the admin sheet carrying arrays they never touch — and `withForm`'s
// invariant generics make every such addition ripple through every
// profile form in the app.

export const profilePromptAnswerSchema = z.object({
  key: z.enum(PROFILE_PROMPT_KEYS),
  answer: z
    .string()
    .trim()
    .min(1, "Write an answer or remove the prompt")
    .max(
      PROMPT_ANSWER_MAX_LENGTH,
      `At most ${PROMPT_ANSWER_MAX_LENGTH} characters`,
    ),
});

export const profileDisciplineRatingSchema = z.object({
  discipline: z.enum(DISCIPLINE_KEYS),
  level: z.enum(DISCIPLINE_LEVEL_KEYS),
});

export const profileFacetsInputSchema = z.object({
  prompts: z
    .array(profilePromptAnswerSchema)
    .max(MAX_ANSWERED_PROMPTS, `Pick at most ${MAX_ANSWERED_PROMPTS} prompts`)
    // The primary key is (user_id, prompt_key), so a duplicate would
    // fail at the database with a constraint error the member cannot
    // act on. Caught here, it names the actual problem.
    .refine(
      (rows) => new Set(rows.map((r) => r.key)).size === rows.length,
      "Each prompt can only be answered once",
    ),
  disciplines: z
    .array(profileDisciplineRatingSchema)
    .refine(
      (rows) => new Set(rows.map((r) => r.discipline)).size === rows.length,
      "Each discipline can only be rated once",
    ),
});

export type ProfileFacetsInput = z.infer<typeof profileFacetsInputSchema>;

/**
 * `""` → `null` for the optional profile text columns.
 *
 * Every one of `bio`, `trail_name`, `pronouns` and `status_line` is
 * nullable, and the schema's stated invariant is that **NULL means
 * "not set" and `""` never occurs** — readers omit the line entirely
 * for null, where an empty string is truthy enough to render an
 * element with its own spacing.
 *
 * The zod schemas keep these as plain strings so the forms can bind
 * them, so the conversion has to happen at the write. It lives here,
 * once, because there are **three** writers — registration, the
 * member's own Profile tab, and the admin sheet — and the first
 * version of this normalised in only one of them, leaving every new
 * registrant with three empty strings on disk.
 */
export function optionalProfileText<
  T extends {
    bio?: string;
    trailName?: string;
    pronouns?: string;
    statusLine?: string;
  },
>(
  data: T,
): {
  bio?: string | null;
  trailName?: string | null;
  pronouns?: string | null;
  statusLine?: string | null;
} {
  const orNull = (value: string | undefined) =>
    value === undefined ? undefined : value.length > 0 ? value : null;
  return {
    ...(data.bio === undefined ? {} : { bio: orNull(data.bio) }),
    ...(data.trailName === undefined
      ? {}
      : { trailName: orNull(data.trailName) }),
    ...(data.pronouns === undefined ? {} : { pronouns: orNull(data.pronouns) }),
    ...(data.statusLine === undefined
      ? {}
      : { statusLine: orNull(data.statusLine) }),
  };
}
