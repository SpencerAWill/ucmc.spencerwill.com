/**
 * Zod schemas for calendar mutation inputs (issue #187).
 *
 * Shared by the server-fn `validator` (server side) and the TypeScript
 * types the mutation hooks and the event form consume (client side), so
 * the wire shape and the form shape cannot drift.
 */
import { z } from "zod";

import { eventKind, eventVisibility } from "#/../drizzle/schema";
import { RecurrenceError, normalizeRrule } from "#/server/events/recurrence";

export const EVENT_LIMITS = {
  title: { min: 1, max: 120 },
  description: { max: 4000 },
  location: { max: 200 },
} as const;

/**
 * How far either side of "now" a calendar window may reach.
 *
 * The page asks for a month and the feed for a rolling year, so this is
 * not a product limit — it is what stops a crafted query asking the
 * expander for ten thousand years of a weekly series. Paired with
 * `MAX_OCCURRENCES` in the expander: that bounds one series, this
 * bounds the window every series is expanded across.
 */
export const CALENDAR_WINDOW_MAX_DAYS = 800;

/**
 * An instant on the wire.
 *
 * Epoch milliseconds rather than an ISO string: the Temporal
 * serialization adapters in `src/start.ts` carry `Temporal.Instant`
 * across the server-fn boundary for *results*, but a zod `validator`
 * runs on the raw request body before any of that, so inputs take the
 * numeric form the rest of the app's DTOs already use for `*Ms` fields.
 */
const instantMs = z
  .number()
  .int()
  .transform((ms) => Temporal.Instant.fromEpochMilliseconds(ms));

/**
 * An officer-supplied RRULE, normalized on the way in.
 *
 * Validated by the expander's own parser rather than by a second
 * regex here — one definition of "a rule we support", so a rule that
 * passes the form is a rule the expander can expand. Storing the
 * canonical spelling is what lets the feed emit the stored string
 * verbatim.
 */
const rruleSchema = z
  .string()
  .trim()
  .max(400)
  .transform((raw, ctx) => {
    try {
      return normalizeRrule(raw);
    } catch (err) {
      ctx.addIssue({
        code: "custom",
        message:
          err instanceof RecurrenceError
            ? err.message
            : "Recurrence rule could not be read",
      });
      return z.NEVER;
    }
  });

const nullableTrimmed = (max: number) =>
  z.string().trim().max(max).nullable().default(null);

const eventFields = {
  title: z
    .string()
    .trim()
    .min(EVENT_LIMITS.title.min)
    .max(EVENT_LIMITS.title.max),
  description: nullableTrimmed(EVENT_LIMITS.description.max),
  location: nullableTrimmed(EVENT_LIMITS.location.max),
  startsAt: instantMs,
  endsAt: instantMs.nullable().default(null),
  allDay: z.boolean().default(false),
  kind: z.enum(eventKind),
  visibility: z.enum(eventVisibility).default("members"),
  rrule: rruleSchema.nullable().default(null),
};

/**
 * `ends_at` must not precede `starts_at`.
 *
 * Equal is allowed: a zero-length event is a legitimate way to express
 * "this happens at 19:00" when an officer would rather set an explicit
 * end than leave it null.
 */
const endsAfterStart = <
  T extends z.ZodType<{
    startsAt: Temporal.Instant;
    endsAt: Temporal.Instant | null;
  }>,
>(
  schema: T,
) =>
  schema.refine(
    (value) =>
      value.endsAt === null ||
      Temporal.Instant.compare(value.endsAt, value.startsAt) >= 0,
    { message: "End time must not be before the start time", path: ["endsAt"] },
  );

export const createEventInputSchema = endsAfterStart(z.object(eventFields));

export const updateEventInputSchema = endsAfterStart(
  z.object({ publicId: z.string().min(1), ...eventFields }),
);

export const deleteEventInputSchema = z.object({
  publicId: z.string().min(1),
});

export const cancelEventInputSchema = z.object({
  publicId: z.string().min(1),
  /** False un-cancels, for the officer who clicked it by mistake. */
  canceled: z.boolean().default(true),
});

/**
 * Skip or move one occurrence of a recurring series.
 *
 * `occurrenceStart` is the slot's ORIGINAL start — the identity, not
 * the new time. Overriding to a different time sets `startsAt` while
 * `occurrenceStart` stays put, which is what keeps the override
 * addressable and what `RECURRENCE-ID` means in the emitted feed.
 */
export const overrideOccurrenceInputSchema = z.object({
  publicId: z.string().min(1),
  occurrenceStart: instantMs,
  canceled: z.boolean().default(false),
  title: nullableTrimmed(EVENT_LIMITS.title.max),
  description: nullableTrimmed(EVENT_LIMITS.description.max),
  location: nullableTrimmed(EVENT_LIMITS.location.max),
  startsAt: instantMs.nullable().default(null),
  endsAt: instantMs.nullable().default(null),
});

/** Clear an override, putting the occurrence back on the series. */
export const clearOccurrenceOverrideInputSchema = z.object({
  publicId: z.string().min(1),
  occurrenceStart: instantMs,
});

export const calendarWindowInputSchema = z
  .object({
    from: instantMs,
    until: instantMs,
    kinds: z.array(z.enum(eventKind)).optional(),
  })
  .refine(
    (value) =>
      Temporal.Instant.compare(value.until, value.from) > 0 &&
      value.until.epochMilliseconds - value.from.epochMilliseconds <=
        CALENDAR_WINDOW_MAX_DAYS * 24 * 60 * 60 * 1000,
    {
      message: `Window must be positive and at most ${CALENDAR_WINDOW_MAX_DAYS} days`,
      path: ["until"],
    },
  );

/**
 * Two type families, because these schemas transform.
 *
 * `*Input` is the wire shape — epoch-millisecond numbers and an
 * officer's raw RRULE text — and is what the form and the mutation
 * hooks build. `*Args` is what falls out the other side of the
 * validator: `Temporal.Instant`s and a normalized rule. **Actions take
 * `*Args`**, since by the time one runs, the `createServerFn`
 * validator has already parsed. Intersecting the input type with the
 * parsed fields instead would give `number & Temporal.Instant`, a type
 * nothing can satisfy.
 *
 * The window schema has no `*Args` twin: its reader takes
 * `CalendarWindowQuery` (in the actions module), which carries an extra
 * `scope` the wire shape has no business accepting — the feed sets it
 * from a resolved token, never from the request.
 */
export type CreateEventInput = z.input<typeof createEventInputSchema>;
export type UpdateEventInput = z.input<typeof updateEventInputSchema>;
export type DeleteEventInput = z.input<typeof deleteEventInputSchema>;
export type CancelEventInput = z.input<typeof cancelEventInputSchema>;
export type OverrideOccurrenceInput = z.input<
  typeof overrideOccurrenceInputSchema
>;
export type ClearOccurrenceOverrideInput = z.input<
  typeof clearOccurrenceOverrideInputSchema
>;
export type CalendarWindowInput = z.input<typeof calendarWindowInputSchema>;

export type CreateEventArgs = z.output<typeof createEventInputSchema>;
export type UpdateEventArgs = z.output<typeof updateEventInputSchema>;
export type DeleteEventArgs = z.output<typeof deleteEventInputSchema>;
export type CancelEventArgs = z.output<typeof cancelEventInputSchema>;
export type OverrideOccurrenceArgs = z.output<
  typeof overrideOccurrenceInputSchema
>;
export type ClearOccurrenceOverrideArgs = z.output<
  typeof clearOccurrenceOverrideInputSchema
>;
