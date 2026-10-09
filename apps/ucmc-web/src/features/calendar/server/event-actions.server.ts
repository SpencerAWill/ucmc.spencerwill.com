/**
 * Club calendar actions (issue #187).
 *
 * Reads choose a visibility scope from the viewer and hand it to the
 * repo; writes gate on `events:manage` here at the action layer and
 * record one audit event each.
 *
 * **The visibility projection is the load-bearing part of this file.**
 * `visibility = 'officers'` events are filtered in the SQL `WHERE`, not
 * in the payload and certainly not in the client. An exec meeting that
 * reached the SSR payload of a page a member can load would be readable
 * from View Source whatever the component rendered — and the same event
 * would be sitting in that member's phone the moment they subscribed.
 *
 * **Every write bumps `sequence`.** RFC 5545 has clients compare it to
 * decide whether an incoming VEVENT supersedes the copy they hold, so a
 * missed bump means the edit silently never appears on anyone's
 * calendar. It is incremented in SQL (`sequence + 1`) rather than read
 * and written back, so two officers editing at once cannot both write
 * the same value.
 */
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import {
  requireEventManager,
  viewerCanReadPrivate,
  viewerIsApprovedMember,
} from "#/features/calendar/server/calendar-permissions.server";
import type {
  CancelEventArgs,
  ClearOccurrenceOverrideArgs,
  CreateEventArgs,
  DeleteEventArgs,
  OverrideOccurrenceArgs,
  UpdateEventArgs,
} from "#/features/calendar/server/event-schemas";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { getDb, schema } from "#/server/db";
import {
  getEventByPublicIdUnscoped,
  getEventByPublicId,
  listEventSeriesForWindow,
  listExceptionsFor,
  visibilityScopeFor,
} from "#/server/events/events-repo.server";
import type { VisibilityScope } from "#/server/events/events-repo.server";
import type { CalendarOccurrence } from "#/server/events/occurrences";
import { buildOccurrences } from "#/server/events/occurrences";

/** The scope for whoever is making the current request. */
export async function currentVisibilityScope(): Promise<VisibilityScope> {
  const [approved, canReadPrivate] = await Promise.all([
    viewerIsApprovedMember(),
    viewerCanReadPrivate(),
  ]);
  return visibilityScopeFor(approved, canReadPrivate);
}

export interface CalendarWindowQuery {
  from: Temporal.Instant;
  until: Temporal.Instant;
  kinds?: readonly schema.EventKind[];
  /**
   * Overrides the viewer-derived scope. The `.ics` feed passes one
   * explicitly because it resolves a bearer token to a user and has no
   * session to read a principal from.
   */
  scope?: VisibilityScope;
}

/**
 * Occurrences overlapping a window, visible to the caller.
 *
 * Returns cancelled occurrences too — the page filters them, the feed
 * must publish them as `STATUS:CANCELLED` or subscribers' copies never
 * disappear. See {@link CalendarOccurrence.canceled}.
 */
export async function listCalendarOccurrencesAction({
  from,
  until,
  kinds,
  scope,
}: CalendarWindowQuery): Promise<CalendarOccurrence[]> {
  const effectiveScope = scope ?? (await currentVisibilityScope());
  const series = await listEventSeriesForWindow(
    effectiveScope,
    from,
    until,
    kinds,
  );
  const exceptions = await listExceptionsFor(series.map((row) => row.id));
  return buildOccurrences(series, exceptions, from, until);
}

/** One series, for the detail panel. Scoped — a miss reads as not found. */
export async function getCalendarEventAction(
  publicId: string,
): Promise<CalendarOccurrence | null> {
  const scope = await currentVisibilityScope();
  const series = await getEventByPublicId(publicId, scope);
  if (!series) {
    return null;
  }
  const exceptions = await listExceptionsFor([series.id]);
  // A window wide enough to carry the series' own anchor, so a
  // non-recurring event always yields its single occurrence.
  const from = series.startsAt;
  const until = series.startsAt.add({ hours: 24 });
  return buildOccurrences([series], exceptions, from, until).at(0) ?? null;
}

export async function createEventAction(
  input: CreateEventArgs,
): Promise<{ publicId: string }> {
  const principal = await requireEventManager();
  const id = `evt_${uuidv7()}`;
  const publicId = generatePublicId();

  await getDb().insert(schema.events).values({
    id,
    publicId,
    title: input.title,
    description: input.description,
    location: input.location,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay,
    kind: input.kind,
    visibility: input.visibility,
    rrule: input.rrule,
    createdBy: principal.userId,
    updatedBy: principal.userId,
  });

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "event.created",
    targetType: "event",
    targetId: publicId,
    metadata: {
      title: input.title,
      kind: input.kind,
      visibility: input.visibility,
      recurring: input.rrule !== null,
    },
  });

  return { publicId };
}

export async function updateEventAction(input: UpdateEventArgs): Promise<void> {
  const principal = await requireEventManager();
  const existing = await loadManageableEvent(input.publicId);

  /**
   * Moving the anchor orphans every exception, because an exception is
   * filed under the slot the series generated — change the anchor and
   * those slots no longer exist. Clearing them is the honest outcome:
   * silently re-pointing "no meeting that week" at a slot the officer
   * never looked at would cancel an arbitrary different week. The same
   * goes for changing the rule itself.
   */
  const anchorMoved =
    Temporal.Instant.compare(existing.startsAt, input.startsAt) !== 0;
  const ruleChanged = existing.rrule !== input.rrule;

  await getDb()
    .update(schema.events)
    .set({
      title: input.title,
      description: input.description,
      location: input.location,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay,
      kind: input.kind,
      visibility: input.visibility,
      rrule: input.rrule,
      // Incremented in SQL rather than read-modify-written, so two
      // officers saving at once cannot both land on the same value and
      // leave one edit invisible to every subscriber.
      sequence: sql`${schema.events.sequence} + 1`,
      updatedAt: Temporal.Now.instant(),
      updatedBy: principal.userId,
    })
    .where(eq(schema.events.id, existing.id));

  if (anchorMoved || ruleChanged) {
    await getDb()
      .delete(schema.eventExceptions)
      .where(eq(schema.eventExceptions.eventId, existing.id));
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "event.updated",
    targetType: "event",
    targetId: input.publicId,
    metadata: {
      title: input.title,
      kind: input.kind,
      visibility: input.visibility,
      exceptionsCleared: anchorMoved || ruleChanged,
    },
  });
}

/**
 * Call a series off, or put it back on.
 *
 * Distinct from deletion on purpose: a cancelled event stays in the
 * feed carrying `STATUS:CANCELLED`, which is what makes subscribers'
 * copies disappear. A deleted row simply stops being emitted, and most
 * clients read that as "no change" and leave it on the calendar.
 */
export async function cancelEventAction(input: CancelEventArgs): Promise<void> {
  const principal = await requireEventManager();
  const existing = await loadManageableEvent(input.publicId);

  await getDb()
    .update(schema.events)
    .set({
      canceledAt: input.canceled ? Temporal.Now.instant() : null,
      sequence: sql`${schema.events.sequence} + 1`,
      updatedAt: Temporal.Now.instant(),
      updatedBy: principal.userId,
    })
    .where(eq(schema.events.id, existing.id));

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "event.canceled",
    targetType: "event",
    targetId: input.publicId,
    metadata: { title: existing.title, canceled: input.canceled },
  });
}

/**
 * Hard-delete a series.
 *
 * For an event that should never have existed. Calling one off wants
 * {@link cancelEventAction} instead — see its note on why the
 * difference matters to subscribers.
 */
export async function deleteEventAction(input: DeleteEventArgs): Promise<void> {
  const principal = await requireEventManager();
  const existing = await loadManageableEvent(input.publicId);

  // Exceptions cascade on the FK.
  await getDb().delete(schema.events).where(eq(schema.events.id, existing.id));

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "event.deleted",
    targetType: "event",
    targetId: input.publicId,
    metadata: { title: existing.title, kind: existing.kind },
  });
}

/** Skip or move one occurrence of a recurring series. */
export async function overrideOccurrenceAction(
  input: OverrideOccurrenceArgs,
): Promise<void> {
  const principal = await requireEventManager();
  const existing = await loadManageableEvent(input.publicId);

  const values = {
    canceled: input.canceled,
    title: input.title,
    description: input.description,
    location: input.location,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    updatedAt: Temporal.Now.instant(),
  };

  await getDb()
    .insert(schema.eventExceptions)
    .values({
      id: `evx_${uuidv7()}`,
      eventId: existing.id,
      occurrenceStart: input.occurrenceStart,
      createdBy: principal.userId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        schema.eventExceptions.eventId,
        schema.eventExceptions.occurrenceStart,
      ],
      set: values,
    });

  // The series' own SEQUENCE still has to move: clients are told about
  // an overridden occurrence through the parent event's feed entry, so
  // a stale sequence hides the override exactly as it would hide an
  // edit to the series itself.
  await bumpSequence(existing.id, principal.userId);

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "event.occurrence_overridden",
    targetType: "event",
    targetId: input.publicId,
    metadata: {
      occurrenceStart: input.occurrenceStart.toString(),
      canceled: input.canceled,
    },
  });
}

/** Put an overridden occurrence back on the series. */
export async function clearOccurrenceOverrideAction(
  input: ClearOccurrenceOverrideArgs,
): Promise<void> {
  const principal = await requireEventManager();
  const existing = await loadManageableEvent(input.publicId);

  await getDb()
    .delete(schema.eventExceptions)
    .where(
      and(
        eq(schema.eventExceptions.eventId, existing.id),
        eq(schema.eventExceptions.occurrenceStart, input.occurrenceStart),
      ),
    );

  await bumpSequence(existing.id, principal.userId);

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "event.occurrence_overridden",
    targetType: "event",
    targetId: input.publicId,
    metadata: {
      occurrenceStart: input.occurrenceStart.toString(),
      cleared: true,
    },
  });
}

async function bumpSequence(id: string, userId: string): Promise<void> {
  await getDb()
    .update(schema.events)
    .set({
      sequence: sql`${schema.events.sequence} + 1`,
      updatedAt: Temporal.Now.instant(),
      updatedBy: userId,
    })
    .where(eq(schema.events.id, id));
}

/**
 * Load an event for a write path, or throw.
 *
 * Goes through the repo's *unscoped* read on purpose: the caller has
 * already cleared `events:manage`, and scoping by visibility would make
 * "edit the exec meeting" fail as though the row did not exist.
 */
async function loadManageableEvent(publicId: string) {
  const row = await getEventByPublicIdUnscoped(publicId);
  if (!row) {
    throw new Error("Event not found");
  }
  return row;
}
