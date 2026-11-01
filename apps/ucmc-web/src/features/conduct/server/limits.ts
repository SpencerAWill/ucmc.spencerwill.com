/**
 * Length caps and wire schemas for conduct input. The numbers live here
 * so the forms and the schemas cannot disagree.
 *
 * Dates travel as `YYYY-MM-DD` strings, the form `<input type="date">`
 * hands over: a `createServerFn` validator runs on the raw request body,
 * before the Temporal serialization adapters, so the schema turns them
 * into `Temporal.PlainDate`s itself. **Actions take the `*Args` (parsed)
 * types**; forms and hooks build the `*Input` (wire) types.
 */
import { z } from "zod";

import { APPEAL_LINE } from "#/server/email/conduct-email";

/** The §9.3 appeal route, worded once for the template, the email and `/my`. */
export { APPEAL_LINE };

export const CONDUCT_LIMITS = {
  bodyMax: 5000,
  statementMax: 5000,
  notesMax: 10000,
  descriptionMax: 500,
  liftReasonMax: 2000,
  locationMax: 200,
  dismissReasonMax: 2000,
  /** Reports one record may cite at creation. */
  reportsPerRecordMax: 50,
} as const;

export const CONDUCT_LEVEL_LABELS = {
  note: "Note",
  warning: "Warning",
  suspension: "Suspension",
  termination: "Termination",
} as const;

/** SCCS, the university office a possible SCOC violation is referred to. */
export const SCCS_PHONE_DISPLAY = "513-556-6814";
export const SCCS_PHONE_HREF = "tel:+15135566814";

/**
 * The member statement a warning, suspension or termination starts from.
 * It names the conduct, the sanction and the dates, and closes with the
 * §9.3 appeal line. The officer fills in the brackets.
 */
export const STATEMENT_TEMPLATE = `Dear [member name],

The Executive Committee has reviewed the following conduct: [describe the conduct and when it happened].

As a result, the club is issuing this [warning / suspension / termination]. [Describe the sanction.] It takes effect on [start date] and runs until [end date, if any].

${APPEAL_LINE}`;

const plainDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .transform((raw, ctx) => {
    try {
      return Temporal.PlainDate.from(raw, { overflow: "reject" });
    } catch {
      ctx.addIssue({ code: "custom", message: "Not a real date" });
      return z.NEVER;
    }
  });

const id = z.string().trim().min(1).max(100);
const notes = z.string().trim().max(CONDUCT_LIMITS.notesMax);
const statement = z.string().trim().min(1).max(CONDUCT_LIMITS.statementMax);

const common = {
  subjectUserId: id,
  internalNotes: notes,
  possibleScoc: z.boolean(),
  /** Report public ids. */
  reportIds: z.array(id).max(CONDUCT_LIMITS.reportsPerRecordMax),
  /** The public id of a record on the same subject this one corrects. */
  supersedesPublicId: id.optional(),
};

function endsNotBeforeStarts(value: {
  startsOn?: Temporal.PlainDate;
  endsOn?: Temporal.PlainDate;
}): boolean {
  return (
    value.startsOn === undefined ||
    value.endsOn === undefined ||
    Temporal.PlainDate.compare(value.endsOn, value.startsOn) >= 0
  );
}

const endsMessage = {
  message: "The end date is before the start date",
  path: ["endsOn"],
};

const voteSchema = z
  .object({
    heldOn: plainDate,
    for: z.number().int().min(0),
    against: z.number().int().min(0),
    abstain: z.number().int().min(0),
    committeeSize: z.number().int().min(1).max(100),
  })
  // Article §9.1: two thirds of the whole committee, not of those voting.
  // The same rule is a CHECK on `conduct_records`.
  .refine((v) => v.for * 3 >= v.committeeSize * 2, {
    message: "A termination needs two thirds of the committee",
    path: ["for"],
  })
  .refine((v) => v.for + v.against + v.abstain <= v.committeeSize, {
    message: "More votes than committee seats",
    path: ["committeeSize"],
  });

export const createRecordSchema = z.discriminatedUnion("level", [
  z.object({
    level: z.literal("note"),
    ...common,
    internalNotes: notes.min(1, "Required"),
    startsOn: plainDate.optional(),
  }),
  z
    .object({
      level: z.literal("warning"),
      ...common,
      memberStatement: statement,
      startsOn: plainDate.optional(),
      endsOn: plainDate.optional(),
    })
    .refine(endsNotBeforeStarts, endsMessage),
  z
    .object({
      level: z.literal("suspension"),
      ...common,
      memberStatement: statement,
      startsOn: plainDate,
      endsOn: plainDate,
    })
    .refine(endsNotBeforeStarts, endsMessage),
  z
    .object({
      level: z.literal("termination"),
      ...common,
      memberStatement: statement,
      startsOn: plainDate.optional(),
      vote: voteSchema,
      /** A warning's public id, on the same subject. */
      priorWarningId: id.optional(),
      /** The explicit acknowledgment that §9.1's warning step was skipped. */
      warningSkipped: z.literal(true).optional(),
    })
    .refine(
      (v) =>
        (v.priorWarningId === undefined) !== (v.warningSkipped === undefined),
      {
        message: "Cite the prior warning, or acknowledge that there was none",
        path: ["priorWarningId"],
      },
    ),
]);

/** What the notice preview needs: the member-facing parts of a record. */
export const previewNoticeSchema = z
  .object({
    level: z.enum(["warning", "suspension", "termination"]),
    memberStatement: statement,
    startsOn: plainDate.optional(),
    endsOn: plainDate.optional(),
    /** Set when the record corrects an earlier one: the notice says so. */
    supersedesPublicId: id.optional(),
  })
  .refine(endsNotBeforeStarts, endsMessage);

/** Internal notes only. The member statement is locked once sent. */
export const updateRecordSchema = z.object({
  recordId: id,
  internalNotes: notes,
});

export const referSchema = z.object({
  recordId: id,
  referredOn: plainDate,
});

export const sccsOutcomeSchema = z.object({
  recordId: id,
  outcome: z.enum(["returned", "sccs_sanctioned"]),
  note: z.string().trim().min(1, "Required").max(CONDUCT_LIMITS.notesMax),
});

export const liftSchema = z.object({
  recordId: id,
  reason: z
    .string()
    .trim()
    .min(1, "Required")
    .max(CONDUCT_LIMITS.liftReasonMax),
  appealOutcome: z.string().trim().max(CONDUCT_LIMITS.liftReasonMax).optional(),
});

export const listRecordsSchema = z.object({
  level: z.enum(["note", "warning", "suspension", "termination"]).optional(),
  /** In force: unlifted, and no end date or one not yet past. */
  active: z.boolean().optional(),
  lifted: z.boolean().optional(),
  referred: z.boolean().optional(),
});

// ── reports ─────────────────────────────────────────────────────────────

/**
 * A member's report. The reporter names the member (`subjectPublicId`) or,
 * when they do not know the name, describes them; one of the two is
 * required, as the `conduct_reports_subject_known` CHECK also insists.
 */
export const submitReportSchema = z
  .object({
    /** The member's public id: internal ids never reach a member. */
    subjectPublicId: id.optional(),
    subjectDescription: z
      .string()
      .trim()
      .max(CONDUCT_LIMITS.descriptionMax)
      .optional(),
    occurredOn: plainDate,
    location: z.string().trim().max(CONDUCT_LIMITS.locationMax),
    body: z.string().trim().min(1, "Required").max(CONDUCT_LIMITS.bodyMax),
    possibleScoc: z.boolean(),
  })
  .refine(
    (v) =>
      v.subjectPublicId !== undefined ||
      (v.subjectDescription !== undefined && v.subjectDescription !== ""),
    {
      message: "Name the member, or describe them",
      path: ["subjectDescription"],
    },
  );

export const listReportsSchema = z.object({
  status: z.enum(["new", "accepted", "dismissed"]).optional(),
});

/** Report public id, and optionally the public id of a record to attach to. */
export const acceptReportSchema = z.object({
  reportId: id,
  recordPublicId: id.optional(),
});

export const dismissReportSchema = z.object({
  reportId: id,
  reason: z
    .string()
    .trim()
    .min(1, "Required")
    .max(CONDUCT_LIMITS.dismissReasonMax),
});

export type SubmitReportInput = z.input<typeof submitReportSchema>;
export type SubmitReportArgs = z.output<typeof submitReportSchema>;
export type AcceptReportArgs = z.output<typeof acceptReportSchema>;
export type DismissReportArgs = z.output<typeof dismissReportSchema>;

export type CreateRecordInput = z.input<typeof createRecordSchema>;
export type CreateRecordArgs = z.output<typeof createRecordSchema>;
export type PreviewNoticeInput = z.input<typeof previewNoticeSchema>;
export type PreviewNoticeArgs = z.output<typeof previewNoticeSchema>;
export type UpdateRecordArgs = z.output<typeof updateRecordSchema>;
export type ReferArgs = z.output<typeof referSchema>;
export type SccsOutcomeArgs = z.output<typeof sccsOutcomeSchema>;
export type LiftArgs = z.output<typeof liftSchema>;
export type ListRecordsFilter = z.output<typeof listRecordsSchema>;
export type ReferInput = z.input<typeof referSchema>;
export type SccsOutcomeInput = z.input<typeof sccsOutcomeSchema>;
export type LiftInput = z.input<typeof liftSchema>;
export type UpdateRecordInput = z.input<typeof updateRecordSchema>;
