/**
 * Read-side actions for `/analytics/activity` — what the club actually
 * did, as distinct from what it scheduled.
 *
 * **That distinction is the honest limit of this page.** `events`
 * records what was PUT ON THE CALENDAR; nothing records who turned up.
 * So "we ran 14 trips" is answerable here and "41 distinct members
 * went on a trip" is not, and the page says so rather than letting a
 * scheduled count stand in for participation. The trips feature
 * (#275) creates the missing source — a lottery roster plus a
 * post-trip confirmation — at which point the participation panels
 * have a home already reserved.
 *
 * The shell wrapper is in `./analytics-fns.ts`.
 */
import { and, count, gte, isNotNull, isNull, lt, sum } from "drizzle-orm";

import {
  SEMESTER_ORDER,
  SEMESTERS,
  currentSeason,
  seasonBoundsFor,
  semesterBoundsFor,
} from "#/config/club-season";
import { CLUB_TIME_ZONE } from "#/config/time";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";

/** Events of one kind, in one month of the season. */
export interface EventsByMonth {
  /** 0 = August, 11 = July — the season axis, not the calendar one. */
  monthIndex: number;
  kind: string;
  events: number;
}

export interface SemesterActivity {
  semester: string;
  label: string;
  events: number;
  /** Fall is 5 months, Spring 4, Summer 3 — so the rate, not the total. */
  perMonth: number;
  serviceHours: number;
  volunteers: number;
}

export interface ActivityAnalytics {
  season: string;
  eventsHeld: number;
  eventsCanceled: number;
  byMonth: EventsByMonth[];
  byKind: { kind: string; events: number }[];
  bySemester: SemesterActivity[];
  serviceHours: number;
  volunteerOutings: number;
  /** Live (non-revoked) calendar feed subscriptions. */
  calendarSubscriptions: number;
  photosAdded: number;
}

async function requireActivityViewer() {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("analytics:view")) {
    throw new Error("Forbidden: missing analytics:view");
  }
  const canReadEvents =
    principal.permissions.includes("events:manage") ||
    principal.permissions.includes("events:read_private");
  if (!canReadEvents) {
    throw new Error("Forbidden: missing events:manage");
  }
  return principal;
}

/**
 * Which month of the season an instant falls in, 0 = August.
 *
 * Resolved through `CLUB_TIME_ZONE` rather than by reading a month off
 * the raw instant: the worker runs UTC and would push an 8pm
 * Cincinnati event into the next day, which at a month boundary is the
 * wrong month and therefore the wrong bar.
 */
function seasonMonthIndex(instant: Temporal.Instant): number {
  const month = instant.toZonedDateTimeISO(CLUB_TIME_ZONE).month;
  return (month - 8 + 12) % 12;
}

export async function activityAnalyticsAction(input: {
  season?: string;
}): Promise<ActivityAnalytics> {
  await requireActivityViewer();

  const season = input.season ?? currentSeason();
  const bounds = seasonBoundsFor(season);
  const start = bounds.start.toInstant();
  const end = bounds.end.toInstant();
  const db = getDb();

  const events = await db
    .select({
      startsAt: schema.events.startsAt,
      kind: schema.events.kind,
      canceledAt: schema.events.canceledAt,
    })
    .from(schema.events)
    .where(
      and(gte(schema.events.startsAt, start), lt(schema.events.startsAt, end)),
    );

  const held = events.filter((event) => event.canceledAt === null);

  const [volunteer] = await db
    .select({
      outings: count(),
      hours: sum(schema.volunteerEvents.serviceHours),
      volunteers: sum(schema.volunteerEvents.volunteersCount),
    })
    .from(schema.volunteerEvents)
    .where(
      and(
        gte(schema.volunteerEvents.startsAt, start),
        lt(schema.volunteerEvents.startsAt, end),
      ),
    );

  const [subscriptions] = await db
    .select({ n: count() })
    .from(schema.calendarSubscriptions)
    .where(isNull(schema.calendarSubscriptions.revokedAt));

  const [photos] = await db
    .select({ n: count() })
    .from(schema.albumPhotos)
    .where(
      and(
        isNotNull(schema.albumPhotos.takenAt),
        gte(schema.albumPhotos.takenAt, start),
        lt(schema.albumPhotos.takenAt, end),
      ),
    );

  return {
    season,
    eventsHeld: held.length,
    eventsCanceled: events.length - held.length,
    byMonth: bucketByMonth(held),
    byKind: bucketByKind(held),
    bySemester: await loadSemesterActivity(season, held),
    // `sum()` answers a string (SQLite's SUM over an integer column
    // comes back through the driver as text) and null for no rows, so
    // both are normalised here rather than at four render sites.
    serviceHours: Number(volunteer.hours ?? 0),
    volunteerOutings: volunteer.outings,
    calendarSubscriptions: subscriptions.n,
    photosAdded: photos.n,
  };
}

interface HeldEvent {
  startsAt: Temporal.Instant;
  kind: string;
}

/**
 * Events per (season month, kind), with **every month present**.
 *
 * A reporting axis needs the gap drawn, not skipped: a month with no
 * events is a month the club did nothing, which is information, and
 * omitting the row would silently close the gap and make the season
 * look continuously busy.
 */
export function bucketByMonth(events: HeldEvent[]): EventsByMonth[] {
  const kinds = [...new Set(events.map((event) => event.kind))].sort();
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = `${seasonMonthIndex(event.startsAt)} ${event.kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const out: EventsByMonth[] = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    for (const kind of kinds) {
      out.push({
        monthIndex,
        kind,
        events: counts.get(`${monthIndex} ${kind}`) ?? 0,
      });
    }
  }
  return out;
}

export function bucketByKind(
  events: HeldEvent[],
): { kind: string; events: number }[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, n]) => ({ kind, events: n }))
    .sort((a, b) => b.events - a.events || a.kind.localeCompare(b.kind));
}

async function loadSemesterActivity(
  season: string,
  held: HeldEvent[],
): Promise<SemesterActivity[]> {
  const db = getDb();
  const out: SemesterActivity[] = [];
  for (const semester of SEMESTER_ORDER) {
    const bounds = semesterBoundsFor(season, semester);
    const start = bounds.start.toInstant();
    const end = bounds.end.toInstant();

    const events = held.filter(
      (event) =>
        Temporal.Instant.compare(event.startsAt, start) >= 0 &&
        Temporal.Instant.compare(event.startsAt, end) < 0,
    ).length;

    const [volunteer] = await db
      .select({
        hours: sum(schema.volunteerEvents.serviceHours),
        volunteers: sum(schema.volunteerEvents.volunteersCount),
      })
      .from(schema.volunteerEvents)
      .where(
        and(
          gte(schema.volunteerEvents.startsAt, start),
          lt(schema.volunteerEvents.startsAt, end),
        ),
      );

    const meta = SEMESTERS[semester];
    out.push({
      semester,
      label: meta.label,
      events,
      perMonth: events / meta.monthCount,
      serviceHours: Number(volunteer.hours ?? 0),
      volunteers: Number(volunteer.volunteers ?? 0),
    });
  }
  return out;
}
