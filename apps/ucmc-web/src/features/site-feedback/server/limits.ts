import { z } from "zod";

export const SITE_FEEDBACK_LIMITS = {
  title: { min: 1, max: 120 },
  // Single-textarea body, used by general feedback only.
  body: { min: 1, max: 5000 },
  // Per-section limits for the structured bug + feature templates.
  // Sized small enough to encourage focused answers without truncating
  // a thoughtful submitter.
  section: { min: 1, max: 1500 },
  optionalSection: { max: 1000 },
  pageUrl: { max: 500 },
  userAgent: { max: 500 },
} as const;

export const SITE_FEEDBACK_KIND_VALUES = ["bug", "feature", "general"] as const;

export const SITE_FEEDBACK_STATUS_VALUES = [
  "open",
  "acknowledged",
  "resolved",
  "closed",
] as const;

export type SiteFeedbackKind = (typeof SITE_FEEDBACK_KIND_VALUES)[number];
export type SiteFeedbackStatus = (typeof SITE_FEEDBACK_STATUS_VALUES)[number];

export const SITE_FEEDBACK_KIND_LABELS: Record<SiteFeedbackKind, string> = {
  bug: "Bug report",
  feature: "Feature request",
  general: "General feedback",
};

export const SITE_FEEDBACK_STATUS_LABELS: Record<SiteFeedbackStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  closed: "Closed",
};

const titleField = z
  .string()
  .trim()
  .min(SITE_FEEDBACK_LIMITS.title.min, "Required")
  .max(
    SITE_FEEDBACK_LIMITS.title.max,
    `At most ${SITE_FEEDBACK_LIMITS.title.max} characters`,
  );

const requiredSectionField = z
  .string()
  .trim()
  .min(SITE_FEEDBACK_LIMITS.section.min, "Required")
  .max(
    SITE_FEEDBACK_LIMITS.section.max,
    `At most ${SITE_FEEDBACK_LIMITS.section.max} characters`,
  );

const optionalSectionField = z
  .string()
  .trim()
  .max(
    SITE_FEEDBACK_LIMITS.optionalSection.max,
    `At most ${SITE_FEEDBACK_LIMITS.optionalSection.max} characters`,
  )
  .optional()
  .or(z.literal(""));

const generalBodyField = z
  .string()
  .trim()
  .min(SITE_FEEDBACK_LIMITS.body.min, "Required")
  .max(
    SITE_FEEDBACK_LIMITS.body.max,
    `At most ${SITE_FEEDBACK_LIMITS.body.max} characters`,
  );

const pageUrlField = z
  .string()
  .trim()
  .max(SITE_FEEDBACK_LIMITS.pageUrl.max)
  .optional()
  .or(z.literal(""));

const userAgentField = z
  .string()
  .trim()
  .max(SITE_FEEDBACK_LIMITS.userAgent.max)
  .optional()
  .or(z.literal(""));

// Bug report — mirrors `.github/ISSUE_TEMPLATE/bug_report.md`. Skipped:
// "Screenshots" (file uploads not supported here — submitters can paste
// links into "Additional context"), and the OS/Browser/Version block,
// which we capture automatically from `userAgent`.
export const bugFeedbackSchema = z.object({
  kind: z.literal("bug"),
  title: titleField,
  bugDescription: requiredSectionField,
  stepsToReproduce: requiredSectionField,
  expectedBehavior: requiredSectionField,
  additionalContext: optionalSectionField,
  pageUrl: pageUrlField,
  userAgent: userAgentField,
});

// Feature request — mirrors `.github/ISSUE_TEMPLATE/feature_request.md`.
export const featureFeedbackSchema = z.object({
  kind: z.literal("feature"),
  title: titleField,
  problem: requiredSectionField,
  proposedSolution: requiredSectionField,
  alternatives: optionalSectionField,
  additionalContext: optionalSectionField,
  pageUrl: pageUrlField,
  userAgent: userAgentField,
});

// General feedback — free-form catch-all.
export const generalFeedbackSchema = z.object({
  kind: z.literal("general"),
  title: titleField,
  body: generalBodyField,
  pageUrl: pageUrlField,
  userAgent: userAgentField,
});

export const siteFeedbackInputSchema = z.discriminatedUnion("kind", [
  bugFeedbackSchema,
  featureFeedbackSchema,
  generalFeedbackSchema,
]);

export type BugFeedbackInput = z.infer<typeof bugFeedbackSchema>;
export type FeatureFeedbackInput = z.infer<typeof featureFeedbackSchema>;
export type GeneralFeedbackInput = z.infer<typeof generalFeedbackSchema>;
export type SiteFeedbackInput = z.infer<typeof siteFeedbackInputSchema>;

export const siteFeedbackStatusUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(SITE_FEEDBACK_STATUS_VALUES),
});

export type SiteFeedbackStatusUpdateInput = z.infer<
  typeof siteFeedbackStatusUpdateSchema
>;
