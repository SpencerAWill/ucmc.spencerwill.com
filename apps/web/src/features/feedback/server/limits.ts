import { z } from "zod";

export const FEEDBACK_LIMITS = {
  title: { min: 1, max: 120 },
  body: { min: 1, max: 5000 },
  pageUrl: { max: 500 },
  userAgent: { max: 500 },
} as const;

export const FEEDBACK_KIND_VALUES = [
  "bug",
  "feature",
  "general",
  "question",
] as const;

export const FEEDBACK_STATUS_VALUES = [
  "open",
  "acknowledged",
  "resolved",
  "closed",
] as const;

export type FeedbackKind = (typeof FEEDBACK_KIND_VALUES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUS_VALUES)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "Bug report",
  feature: "Feature request",
  general: "General feedback",
  question: "Question",
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  closed: "Closed",
};

export const feedbackInputSchema = z.object({
  kind: z.enum(FEEDBACK_KIND_VALUES),
  title: z
    .string()
    .trim()
    .min(FEEDBACK_LIMITS.title.min, "Required")
    .max(
      FEEDBACK_LIMITS.title.max,
      `At most ${FEEDBACK_LIMITS.title.max} characters`,
    ),
  body: z
    .string()
    .trim()
    .min(FEEDBACK_LIMITS.body.min, "Required")
    .max(
      FEEDBACK_LIMITS.body.max,
      `At most ${FEEDBACK_LIMITS.body.max} characters`,
    ),
  pageUrl: z
    .string()
    .trim()
    .max(FEEDBACK_LIMITS.pageUrl.max)
    .optional()
    .or(z.literal("")),
  userAgent: z
    .string()
    .trim()
    .max(FEEDBACK_LIMITS.userAgent.max)
    .optional()
    .or(z.literal("")),
});

export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export const feedbackStatusUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(FEEDBACK_STATUS_VALUES),
});

export type FeedbackStatusUpdateInput = z.infer<
  typeof feedbackStatusUpdateSchema
>;
