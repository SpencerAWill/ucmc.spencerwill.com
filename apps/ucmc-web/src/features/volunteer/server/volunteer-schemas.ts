/**
 * Zod schemas for /volunteer mutation inputs. Shared by the server-fn
 * `validator` (server side) and the TypeScript types the mutation hooks
 * and forms consume (client side), so the wire shape and the form shape
 * can't drift.
 */
import { z } from "zod";

import { CURATED_ICONS } from "#/components/curated-icon/icon-names";

/**
 * The only schemes an officer-supplied link may use. Anchored and
 * case-insensitive: `JavaScript:` and ` javascript:` must not slip past
 * (the value is `.trim()`ed before this runs, so leading whitespace is
 * already gone, but the anchor is what makes that irrelevant).
 */
export const HTTP_SCHEME = /^https?:\/\//i;

export const VOLUNTEER_LIMITS = {
  opportunityTitle: { min: 1, max: 40 },
  opportunityBlurb: { min: 1, max: 200 },
  eventTitle: { min: 1, max: 120 },
  partnerOrg: { max: 120 },
  location: { max: 160 },
  description: { max: 1000 },
  // A person-hours total, not a duration — a 4-hour trail day with 12
  // people is 48. Capped well above anything a single outing can
  // plausibly produce so a slipped decimal point is caught at the edge
  // rather than quietly inflating the archive's headline total.
  serviceHours: { max: 10_000 },
  volunteersCount: { max: 1_000 },
} as const;

/**
 * Reorder cap, exported so the client can't submit a list the server
 * will reject. Enforced on both sides, the same arrangement as
 * `ROLE_MEMBERS_DIFF_MAX` and `BULK_ATTEST_MAX`.
 */
export const VOLUNTEER_REORDER_MAX = 200;

const opportunityFields = {
  icon: z.enum(CURATED_ICONS),
  title: z
    .string()
    .trim()
    .min(VOLUNTEER_LIMITS.opportunityTitle.min)
    .max(VOLUNTEER_LIMITS.opportunityTitle.max),
  blurb: z
    .string()
    .trim()
    .min(VOLUNTEER_LIMITS.opportunityBlurb.min)
    .max(VOLUNTEER_LIMITS.opportunityBlurb.max),
} as const;

export const createOpportunityInputSchema = z.object(opportunityFields);
export type CreateOpportunityInput = z.infer<
  typeof createOpportunityInputSchema
>;

export const updateOpportunityInputSchema = z.object({
  id: z.string().min(1),
  ...opportunityFields,
});
export type UpdateOpportunityInput = z.infer<
  typeof updateOpportunityInputSchema
>;

export const deleteByIdInputSchema = z.object({ id: z.string().min(1) });
export type DeleteByIdInput = z.infer<typeof deleteByIdInputSchema>;

/**
 * New display order, lowest sort_order first. The server rewrites every
 * row's sort_order to its index + 1 so the canonical order stays dense
 * across add → reorder → delete.
 */
export const reorderOpportunitiesInputSchema = z.object({
  ids: z.array(z.string().min(1)).max(VOLUNTEER_REORDER_MAX),
});
export type ReorderOpportunitiesInput = z.infer<
  typeof reorderOpportunitiesInputSchema
>;

/**
 * Timestamps cross the wire as epoch milliseconds rather than as
 * `Temporal.Instant`s. The serialization adapters registered in
 * `start.ts` would carry an Instant fine, but the form's underlying
 * control is `<input type="datetime-local">`, whose value is a local
 * wall-clock string — the component owns that conversion and hands the
 * action a plain number, matching how the Album's `takenAt` and the
 * Gazette's `publishedAt` cross.
 */
const nullableTrimmed = (max: number) =>
  z.string().trim().max(max).nullable().default(null);

const eventFields = {
  title: z
    .string()
    .trim()
    .min(VOLUNTEER_LIMITS.eventTitle.min)
    .max(VOLUNTEER_LIMITS.eventTitle.max),
  partnerOrg: nullableTrimmed(VOLUNTEER_LIMITS.partnerOrg.max),
  location: nullableTrimmed(VOLUNTEER_LIMITS.location.max),
  startsAtMs: z.number().int(),
  endsAtMs: z.number().int().nullable().default(null),
  description: nullableTrimmed(VOLUNTEER_LIMITS.description.max),
  // **`z.url()` alone is not enough here.** Zod accepts any parseable
  // URL, scheme included — `javascript:alert(1)`, `data:text/html,…` and
  // `vbscript:` all pass — and this value is rendered straight into an
  // `<a href>` on a page anonymous visitors can see. Since
  // `public_volunteer:manage` is seeded ungranted specifically so it can
  // be delegated to a non-admin role, an unrestricted scheme is a stored
  // XSS handed to whoever holds that delegation. The protocol allowlist
  // is the fix; `outingJoinHref` re-checks at render time, because a
  // schema can only guard writes made after it shipped.
  signupUrl: z
    .string()
    .trim()
    .url()
    .refine((v) => HTTP_SCHEME.test(v), {
      message: "Enter an http:// or https:// link",
    })
    .nullable()
    .default(null),
  volunteersCount: z
    .number()
    .int()
    .min(0)
    .max(VOLUNTEER_LIMITS.volunteersCount.max)
    .nullable()
    .default(null),
  serviceHours: z
    .number()
    .int()
    .min(0)
    .max(VOLUNTEER_LIMITS.serviceHours.max)
    .nullable()
    .default(null),
  albumTag: nullableTrimmed(80),
} as const;

export const createEventInputSchema = z
  .object(eventFields)
  .refine((v) => v.endsAtMs === null || v.endsAtMs >= v.startsAtMs, {
    message: "The end time can't be before the start time",
    path: ["endsAtMs"],
  });
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

export const updateEventInputSchema = z
  .object({ id: z.string().min(1), ...eventFields })
  .refine((v) => v.endsAtMs === null || v.endsAtMs >= v.startsAtMs, {
    message: "The end time can't be before the start time",
    path: ["endsAtMs"],
  });
export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;
