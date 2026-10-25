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
  "wont_fix",
  "duplicate",
] as const;

// The submission's own disposition. Legacy `acknowledged` displays as
// New and legacy `closed` as Won't fix; they are not rewritten.
export const SITE_FEEDBACK_DISPOSITION_VALUES = [
  "open",
  "wont_fix",
  "duplicate",
  "resolved",
] as const;

// Derived on read from the disposition plus the linked issues.
export const SITE_FEEDBACK_STATE_VALUES = [
  "new",
  "in_draft",
  "tracked",
  "resolved",
  "wont_fix",
  "duplicate",
] as const;

export const SITE_FEEDBACK_ISSUE_STATE_VALUES = [
  "draft",
  "filing",
  "open",
  "closed",
] as const;

export type SiteFeedbackKind = (typeof SITE_FEEDBACK_KIND_VALUES)[number];
export type SiteFeedbackStatus = (typeof SITE_FEEDBACK_STATUS_VALUES)[number];
export type SiteFeedbackDisposition =
  (typeof SITE_FEEDBACK_DISPOSITION_VALUES)[number];
export type SiteFeedbackState = (typeof SITE_FEEDBACK_STATE_VALUES)[number];
export type SiteFeedbackIssueState =
  (typeof SITE_FEEDBACK_ISSUE_STATE_VALUES)[number];

export const SITE_FEEDBACK_KIND_LABELS: Record<SiteFeedbackKind, string> = {
  bug: "Bug report",
  feature: "Feature request",
  general: "General feedback",
};

export const SITE_FEEDBACK_STATE_LABELS: Record<SiteFeedbackState, string> = {
  new: "New",
  in_draft: "In draft",
  tracked: "Tracked",
  resolved: "Resolved",
  wont_fix: "Won't fix",
  duplicate: "Duplicate",
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

// ── triage inputs ───────────────────────────────────────────────────────

export const SITE_FEEDBACK_TRIAGE_VIEW_VALUES = [
  "new",
  "in_draft",
  "tracked",
  "closed",
] as const;

export type SiteFeedbackTriageView =
  (typeof SITE_FEEDBACK_TRIAGE_VIEW_VALUES)[number];

/** Most submissions one draft, link or disposition call may carry. */
export const SITE_FEEDBACK_BULK_MAX = 200;

const idField = z.string().min(1).max(100);
const idsField = z.array(idField).min(1).max(SITE_FEEDBACK_BULK_MAX);

export const siteFeedbackTriageListSchema = z.object({
  view: z.enum(SITE_FEEDBACK_TRIAGE_VIEW_VALUES),
  q: z.string().trim().max(200).optional(),
});
export type SiteFeedbackTriageListInput = z.infer<
  typeof siteFeedbackTriageListSchema
>;

export const siteFeedbackDispositionSchema = z.object({
  ids: idsField,
  disposition: z.enum(SITE_FEEDBACK_DISPOSITION_VALUES),
});
export type SiteFeedbackDispositionInput = z.infer<
  typeof siteFeedbackDispositionSchema
>;

export const siteFeedbackIssueDraftCreateSchema = z.object({
  feedbackIds: idsField,
});
export type SiteFeedbackIssueDraftCreateInput = z.infer<
  typeof siteFeedbackIssueDraftCreateSchema
>;

export const siteFeedbackIssueIdSchema = z.object({ id: idField });
export type SiteFeedbackIssueIdInput = z.infer<
  typeof siteFeedbackIssueIdSchema
>;

export const siteFeedbackIssueDraftUpdateSchema = z.object({
  id: idField,
  title: z.string().trim().min(1, "Required").max(256),
  summaryMd: z.string().max(20_000),
  labels: z.array(z.string().trim().min(1).max(50)).max(20),
  /** Epoch milliseconds of the `updated_at` the editor loaded. */
  expectedUpdatedAtMs: z.number().int().nonnegative(),
});
export type SiteFeedbackIssueDraftUpdateInput = z.infer<
  typeof siteFeedbackIssueDraftUpdateSchema
>;

export const siteFeedbackLinkSchema = z.object({
  issueId: idField,
  feedbackIds: idsField,
});
export type SiteFeedbackLinkInput = z.infer<typeof siteFeedbackLinkSchema>;

export const siteFeedbackUnlinkSchema = z.object({
  issueId: idField,
  feedbackId: idField,
});
export type SiteFeedbackUnlinkInput = z.infer<typeof siteFeedbackUnlinkSchema>;

export const siteFeedbackQuoteUpdateSchema = z.object({
  issueId: idField,
  feedbackId: idField,
  quotedMd: z.string().min(1).max(20_000),
});
export type SiteFeedbackQuoteUpdateInput = z.infer<
  typeof siteFeedbackQuoteUpdateSchema
>;

export const siteFeedbackRelatedSchema = z.object({ issueId: idField });
export type SiteFeedbackRelatedInput = z.infer<
  typeof siteFeedbackRelatedSchema
>;

export const siteFeedbackAttachSchema = z.object({
  number: z.number().int().positive(),
  feedbackIds: idsField,
});
export type SiteFeedbackAttachInput = z.infer<typeof siteFeedbackAttachSchema>;

export const siteFeedbackPostPendingSchema = z.object({ issueId: idField });
export type SiteFeedbackPostPendingInput = z.infer<
  typeof siteFeedbackPostPendingSchema
>;
