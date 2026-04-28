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
// edits the public-ish fields, `/account/details` (Details tab) edits
// the PII fields + emergency contacts. Registration still uses the full
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
