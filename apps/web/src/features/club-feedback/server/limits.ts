/**
 * Shape + size limits for club-feedback submissions.
 *
 * Mirrors `features/feedback/server/limits.ts` in spirit but with a
 * deliberately simpler surface: every kind shares the same title + body
 * payload (no per-kind section templates), because club feedback is
 * narrative governance input, not a defect template.
 */
import { z } from "zod";

export const CLUB_FEEDBACK_LIMITS = {
  title: { min: 1, max: 120 },
  body: { min: 1, max: 5000 },
} as const;

// Keep the literals in sync with `clubFeedbackKind` in drizzle/schema.ts.
// Both arrays are the same closed set; the schema enum is the canonical
// storage contract, this one is the canonical wire/UI contract.
export const CLUB_FEEDBACK_KIND_VALUES = [
  "suggestion",
  "concern",
  "praise",
  "general",
] as const;

export const CLUB_FEEDBACK_STATUS_VALUES = [
  "open",
  "acknowledged",
  "resolved",
  "closed",
] as const;

export type ClubFeedbackKind = (typeof CLUB_FEEDBACK_KIND_VALUES)[number];
export type ClubFeedbackStatus = (typeof CLUB_FEEDBACK_STATUS_VALUES)[number];

export const CLUB_FEEDBACK_KIND_LABELS: Record<ClubFeedbackKind, string> = {
  suggestion: "Suggestion",
  concern: "Concern",
  praise: "Praise",
  general: "General",
};

export const CLUB_FEEDBACK_KIND_HELP: Record<ClubFeedbackKind, string> = {
  suggestion: "An idea for how the club could improve.",
  concern: "Something that's not working — a complaint, conflict, or issue.",
  praise: "Something the exec or club did well that you'd like recognized.",
  general: "Anything else you want the exec board to know.",
};

export const CLUB_FEEDBACK_STATUS_LABELS: Record<ClubFeedbackStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  closed: "Closed",
};

const titleField = z
  .string()
  .trim()
  .min(CLUB_FEEDBACK_LIMITS.title.min, "Required")
  .max(
    CLUB_FEEDBACK_LIMITS.title.max,
    `At most ${CLUB_FEEDBACK_LIMITS.title.max} characters`,
  );

const bodyField = z
  .string()
  .trim()
  .min(CLUB_FEEDBACK_LIMITS.body.min, "Required")
  .max(
    CLUB_FEEDBACK_LIMITS.body.max,
    `At most ${CLUB_FEEDBACK_LIMITS.body.max} characters`,
  );

export const clubFeedbackInputSchema = z.object({
  kind: z.enum(CLUB_FEEDBACK_KIND_VALUES),
  title: titleField,
  body: bodyField,
  // Defaults to false on the wire so the form's onSubmit can omit it.
  // Server uses this to decide whether to strip submitter info from the
  // admin triage view (the row's `createdBy` is still recorded for
  // rate-limit + abuse handling — anonymity is a display contract, not
  // a storage one).
  anonymous: z.boolean().default(false),
});

export type ClubFeedbackInput = z.infer<typeof clubFeedbackInputSchema>;

export const clubFeedbackStatusUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(CLUB_FEEDBACK_STATUS_VALUES),
});

export type ClubFeedbackStatusUpdateInput = z.infer<
  typeof clubFeedbackStatusUpdateSchema
>;
