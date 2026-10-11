/**
 * Data access for the `events` base table (issue #187).
 *
 * **Lives in `src/server/`, not in a feature, deliberately.** `events`
 * is a supertype: `features/calendar` reads it for the page and both
 * `.ics` feeds, and `features/trips` — and later `features/volunteer` —
 * will own satellite tables keyed on `event_id` and need to read it
 * too. Three features is the repo's own threshold for hoisting
 * (CLAUDE.md), and the alternative is a `FEATURE_PUBLIC_API` entry that
 * exists only so siblings can reach into the calendar's internals. This
 * is the same split the audit log already uses: the shared recorder in
 * `src/server/audit/`, the read-side viewer in `features/audit/`.
 *
 * No auth here. The route guard enforces page access, the actions
 * enforce `events:manage`, and the *visibility* projection is decided
 * by the caller and passed in as {@link VisibilityScope} — the repo's
 * job is the row, not who may see it. Threading the decision through
 * would put it in two places; leaving it out would make it too easy to
 * forget. A required parameter is the middle ground: you cannot call
 * these without saying what the viewer may see.
 */
import { and, asc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";

import type { EventKind, EventVisibility } from "#/../drizzle/schema";
import { getDb, inJsonArray, schema } from "#/server/db";

/**
 * The visibility tiers a given viewer may read.
 *
 * Passed explicitly rather than derived here because the answer depends
 * on a `Principal`, and this module deliberately knows nothing about
 * sessions — the `.ics` feed resolves a bearer token to a user without
 * one. {@link visibilityScopeFor} builds it from a permission check.
 */
export type VisibilityScope = readonly EventVisibility[];

/** Tiers visible to an anonymous visitor: the public feed's scope. */
export const PUBLIC_SCOPE: VisibilityScope = ["public"];

/**
 * Tiers visible to an approved member, and to an officer.
 *
 * The tiers nest, so these are prefixes of one another rather than
 * three disjoint sets — which is what lets every read take a single
 * `visibility IN (...)` instead of branching.
 */
export const MEMBER_SCOPE: VisibilityScope = ["public", "members"];
export const OFFICER_SCOPE: VisibilityScope = ["public", "members", "officers"];

/**
 * The scope for a viewer, given whether they hold
 * `events:read_private`.
 *
 * Takes the boolean rather than a `Principal` so the `.ics` feed — which
 * has a user id but no session — can call it with the result of its own
 * permission lookup.
 */
export function visibilityScopeFor(
  isApprovedMember: boolean,
  canReadPrivate: boolean,
): VisibilityScope {
  if (canReadPrivate) {
    return OFFICER_SCOPE;
  }
  return isApprovedMember ? MEMBER_SCOPE : PUBLIC_SCOPE;
}

const eventColumns = {
  id: schema.events.id,
  publicId: schema.events.publicId,
  title: schema.events.title,
  description: schema.events.description,
  location: schema.events.location,
  startsAt: schema.events.startsAt,
  endsAt: schema.events.endsAt,
  allDay: schema.events.allDay,
  kind: schema.events.kind,
  visibility: schema.events.visibility,
  rrule: schema.events.rrule,
  sequence: schema.events.sequence,
  canceledAt: schema.events.canceledAt,
  updatedAt: schema.events.updatedAt,
} as const;

/** A series as the calendar and the feed consume it, before expansion. */
export type EventSeries = Pick<
  typeof schema.events.$inferSelect,
  keyof typeof eventColumns
>;

/**
 * Every series that could contribute an occurrence to `[from, until)`.
 *
 * **Recurring series are returned whole, not filtered by date**, and
 * that is the important part: a weekly meeting that started in August
 * still produces occurrences in November, so a naive
 * `starts_at BETWEEN from AND until` would drop exactly the rows the
 * calendar most needs. Only non-recurring rows can be range-filtered
 * here; recurring ones are narrowed by the expander, which is the only
 * thing that knows where their occurrences actually land.
 *
 * The cost of that is bounded by how many recurring series the club
 * has — a handful per year — so loading them all beats the alternative
 * of materialising occurrences into a table that then has to be kept in
 * sync with every edit.
 *
 * Cancelled series are included: a cancelled event still has to be
 * published as `STATUS:CANCELLED` for subscribers' copies to
 * disappear. The page filters them out; the feed does not.
 */
export async function listEventSeriesForWindow(
  scope: VisibilityScope,
  from: Temporal.Instant,
  until: Temporal.Instant,
  kinds?: readonly EventKind[],
): Promise<EventSeries[]> {
  const kindFilter =
    kinds && kinds.length > 0
      ? inJsonArray(schema.events.kind, [...kinds])
      : undefined;

  return getDb()
    .select(eventColumns)
    .from(schema.events)
    .where(
      and(
        inJsonArray(schema.events.visibility, [...scope]),
        kindFilter,
        // Upper bound applies to every row, recurring or not: a series
        // can never produce an occurrence before its own anchor.
        lt(schema.events.startsAt, until),
        or(
          // Recurring series escape the lower bound entirely — only the
          // expander knows where their occurrences land.
          isNotNull(schema.events.rrule),
          // A one-off overlaps the window if it ends at or after `from`.
          // `ends_at` is nullable (a point-in-time event), so fall back
          // to `starts_at` for those.
          gte(schema.events.endsAt, from),
          and(isNull(schema.events.endsAt), gte(schema.events.startsAt, from)),
        ),
      ),
    )
    .orderBy(asc(schema.events.startsAt), asc(schema.events.id));
}

/** One series by its public id, scoped to what the viewer may see. */
export async function getEventByPublicId(
  publicId: string,
  scope: VisibilityScope,
): Promise<EventSeries | null> {
  const rows = await getDb()
    .select(eventColumns)
    .from(schema.events)
    .where(
      and(
        eq(schema.events.publicId, publicId),
        inJsonArray(schema.events.visibility, [...scope]),
      ),
    )
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * One series by public id, ignoring visibility.
 *
 * For write paths only. An officer editing an event has already cleared
 * `events:manage`, and scoping the read would make "edit the
 * officers-only event" fail in a way indistinguishable from the row not
 * existing. Read paths take {@link getEventByPublicId} instead.
 */
export async function getEventByPublicIdUnscoped(
  publicId: string,
): Promise<EventSeries | null> {
  const rows = await getDb()
    .select(eventColumns)
    .from(schema.events)
    .where(eq(schema.events.publicId, publicId))
    .limit(1);
  return rows.at(0) ?? null;
}

export type EventExceptionRow = {
  occurrenceStart: Temporal.Instant;
  canceled: boolean;
  title: string | null;
  description: string | null;
  location: string | null;
  startsAt: Temporal.Instant | null;
  endsAt: Temporal.Instant | null;
};

/**
 * Exceptions for a set of series, grouped by event id.
 *
 * One query for every series in the window rather than one per series:
 * the expander needs them all, and a per-series call inside the
 * expansion loop is the obvious N+1.
 */
export async function listExceptionsFor(
  eventIds: readonly string[],
): Promise<Map<string, EventExceptionRow[]>> {
  const grouped = new Map<string, EventExceptionRow[]>();
  if (eventIds.length === 0) {
    return grouped;
  }

  // The window's series count is unbounded — every event the club has
  // ever scheduled inside it — so past ~100 events a one-parameter-per-id
  // `IN (...)` 500'd /calendar and both .ics feeds (#259). One JSON
  // parameter keeps it a single statement with a single `ORDER BY` (#291).
  const rows = await getDb()
    .select({
      eventId: schema.eventExceptions.eventId,
      occurrenceStart: schema.eventExceptions.occurrenceStart,
      canceled: schema.eventExceptions.canceled,
      title: schema.eventExceptions.title,
      description: schema.eventExceptions.description,
      location: schema.eventExceptions.location,
      startsAt: schema.eventExceptions.startsAt,
      endsAt: schema.eventExceptions.endsAt,
    })
    .from(schema.eventExceptions)
    .where(inJsonArray(schema.eventExceptions.eventId, [...eventIds]))
    .orderBy(asc(schema.eventExceptions.occurrenceStart));

  for (const { eventId, ...rest } of rows) {
    const bucket = grouped.get(eventId);
    if (bucket) {
      bucket.push(rest);
    } else {
      grouped.set(eventId, [rest]);
    }
  }
  return grouped;
}
