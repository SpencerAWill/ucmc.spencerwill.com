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

export const CONDUCT_LIMITS = {
  bodyMax: 5000,
  statementMax: 5000,
  notesMax: 10000,
  descriptionMax: 500,
  liftReasonMax: 2000,
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

You may appeal in writing within two weeks to the Student Activities Board.`;

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
  active: z.boolean().optional(),
  referred: z.boolean().optional(),
});

export type CreateRecordInput = z.input<typeof createRecordSchema>;
export type CreateRecordArgs = z.output<typeof createRecordSchema>;
export type UpdateRecordArgs = z.output<typeof updateRecordSchema>;
export type ReferArgs = z.output<typeof referSchema>;
export type SccsOutcomeArgs = z.output<typeof sccsOutcomeSchema>;
export type LiftArgs = z.output<typeof liftSchema>;
export type ListRecordsFilter = z.output<typeof listRecordsSchema>;
export type ReferInput = z.input<typeof referSchema>;
export type SccsOutcomeInput = z.input<typeof sccsOutcomeSchema>;
export type LiftInput = z.input<typeof liftSchema>;
export type UpdateRecordInput = z.input<typeof updateRecordSchema>;
