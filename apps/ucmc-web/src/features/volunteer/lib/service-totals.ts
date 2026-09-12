import { currentWaiverCycle } from "#/config/waiver-cycle";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";

export interface ServiceYearGroup {
  /** `"2025-26"` — the club year the outings in this group fall in. */
  clubYear: string;
  outings: VolunteerEventEntry[];
}

export interface ServiceTotals {
  outings: number;
  volunteers: number;
  hours: number;
  /** How many outings actually carried a volunteer count. */
  volunteersReportedFor: number;
  /** How many outings actually carried an hours figure. */
  hoursReportedFor: number;
}

/**
 * Which club year an outing belongs to.
 *
 * Reuses `currentWaiverCycle` rather than defining a second year
 * boundary. The function reads as waiver-specific because that's what
 * needed it first, but it is just "which club year is this instant in",
 * rolling over at midnight Cincinnati-local on Aug 21 — and the club's
 * year is the club's year. Defining a parallel August boundary here is
 * exactly the ad-hoc re-derivation CLAUDE.md warns against; the two
 * would then disagree the first time the cutoff moved.
 */
export function clubYearOf(event: VolunteerEventEntry): string {
  return currentWaiverCycle(
    Temporal.Instant.fromEpochMilliseconds(event.startsAtMs),
  );
}

/**
 * Group past outings into club years, preserving the incoming order
 * (the repo returns newest-first, so groups and their contents both
 * read newest-back).
 */
export function groupByClubYear(
  events: VolunteerEventEntry[],
): ServiceYearGroup[] {
  const groups: ServiceYearGroup[] = [];
  for (const event of events) {
    const clubYear = clubYearOf(event);
    const last = groups.at(-1);
    if (last?.clubYear === clubYear) {
      last.outings.push(event);
    } else {
      groups.push({ clubYear, outings: [event] });
    }
  }
  return groups;
}

/**
 * Sum the archive.
 *
 * Counts and hours are nullable — an officer logs the outing before it
 * happens and fills the numbers in afterwards, if ever — so the totals
 * carry how many outings each figure was actually reported for. The UI
 * says so rather than presenting a sum over an unknown denominator,
 * which would read as "this is all we did" when it means "this is all
 * we wrote down".
 */
export function totalService(events: VolunteerEventEntry[]): ServiceTotals {
  let volunteers = 0;
  let hours = 0;
  let volunteersReportedFor = 0;
  let hoursReportedFor = 0;
  for (const event of events) {
    if (event.volunteersCount !== null) {
      volunteers += event.volunteersCount;
      volunteersReportedFor += 1;
    }
    if (event.serviceHours !== null) {
      hours += event.serviceHours;
      hoursReportedFor += 1;
    }
  }
  return {
    outings: events.length,
    volunteers,
    hours,
    volunteersReportedFor,
    hoursReportedFor,
  };
}
