/**
 * Presentation vocabulary for events — labels, colours and time
 * formatting shared by the month grid, the agenda and the detail panel.
 *
 * One module so the three surfaces cannot disagree about what a "trip"
 * is called or what colour its dot is. A reader who learns the legend on
 * the grid has to be able to apply it in the list.
 */
import type { EventKind, EventVisibility } from "#/../drizzle/schema";
import { CLUB_TIME_ZONE } from "#/config/time";

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  meeting: "Meeting",
  trip: "Trip",
  exec: "Exec",
  social: "Social",
  other: "Event",
};

/**
 * Dot and badge colour per kind.
 *
 * Chosen to stay distinguishable in both themes and to survive the
 * common forms of colour blindness as a *set* — but colour is never the
 * only carrier here: the agenda always prints the kind's label beside
 * the dot, so the grid's dots are a scent, not the information.
 */
export const EVENT_KIND_DOT: Record<EventKind, string> = {
  meeting: "bg-sky-500",
  trip: "bg-emerald-600",
  exec: "bg-amber-600",
  social: "bg-violet-500",
  other: "bg-slate-500",
};

export const EVENT_VISIBILITY_LABEL: Record<EventVisibility, string> = {
  public: "Public",
  members: "Members",
  officers: "Officers only",
};

/**
 * The club-local time of day an occurrence starts, e.g. `6:00 PM`.
 *
 * Deliberately NOT `formatDateTime` from `#/lib/date-format`, which
 * renders in the *viewer's* zone. That is right for an audit timestamp
 * and wrong here: a member in Denver needs the time the club is
 * meeting, not the time it is where they are standing. The club zone is
 * also what the grid's day buckets use, so rendering in any other zone
 * would let a row say 9:00 PM while sitting under the previous day.
 */
export function formatClubTime(instant: Temporal.Instant): string {
  return instant.toLocaleString("en-US", {
    timeZone: CLUB_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `6:00 – 7:00 PM`, or just the start when there is no end. */
export function formatClubTimeRange(
  startsAt: Temporal.Instant,
  endsAt: Temporal.Instant | null,
  allDay: boolean,
): string {
  if (allDay) {
    return "All day";
  }
  if (endsAt === null) {
    return formatClubTime(startsAt);
  }
  return `${formatClubTime(startsAt)} – ${formatClubTime(endsAt)}`;
}

/** `Wednesday, May 6` in the club's zone, for an agenda day heading. */
export function formatClubDayHeading(date: Temporal.PlainDate): string {
  return date.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * `May 2026` — a month heading.
 *
 * **Formatted through a `PlainDate`, never off the `PlainYearMonth`
 * directly.** `Temporal.PlainYearMonth.prototype.toLocaleString` throws
 * `RangeError: Mismatched calendars` whenever the object's calendar
 * (`iso8601`) differs from the locale's resolved one — and `en-US`
 * resolves to `gregory`, so it throws for every month heading on the
 * page. `PlainDate` tolerates the same mismatch and adopts the locale's
 * calendar, which is why `formatClubDayHeading` above has never had the
 * problem; `PlainYearMonth` and `PlainMonthDay` are stricter by spec.
 *
 * It took down the whole page rather than one line, because it threw
 * during render.
 */
export function formatClubMonthHeading(month: Temporal.PlainYearMonth): string {
  return month.toPlainDate({ day: 1 }).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}
