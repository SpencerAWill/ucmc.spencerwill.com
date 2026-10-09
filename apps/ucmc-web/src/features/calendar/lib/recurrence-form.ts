/**
 * The bridge between the event form's repeat controls and an RRULE
 * string (issue #187).
 *
 * **Officers do not type RRULE.** "FREQ=WEEKLY;BYDAY=WE" is a wire
 * format, not a user interface — and the one thing worse than making
 * someone learn it is letting them half-learn it and publish a series
 * that repeats on the wrong day for a semester. So the form offers the
 * four shapes a club actually uses and this module compiles them.
 *
 * Pure and separately tested: the compile/parse round-trip is where a
 * bug would quietly change an existing series' schedule the next time
 * anyone opened it to fix a typo.
 */
import { CLUB_TIME_ZONE } from "#/config/time";
import type { Weekday } from "#/server/events/recurrence";
import { WEEKDAYS, parseRrule } from "#/server/events/recurrence";

export type RepeatMode = "none" | "weekly" | "monthly";
export type MonthlyMode = "dayOfMonth" | "nthWeekday";
export type RepeatEndMode = "never" | "until" | "count";

export interface RecurrenceFormState {
  mode: RepeatMode;
  /** Every N weeks / months. */
  interval: number;
  /** Weekly only. Empty means "the same weekday as the start". */
  weekdays: Weekday[];
  monthlyMode: MonthlyMode;
  endMode: RepeatEndMode;
  /** `YYYY-MM-DD`, as a `<input type="date">` hands it over. */
  untilDate: string;
  count: number;
}

export const EMPTY_RECURRENCE: RecurrenceFormState = {
  mode: "none",
  interval: 1,
  weekdays: [],
  monthlyMode: "dayOfMonth",
  endMode: "never",
  untilDate: "",
  count: 10,
};

/** ISO weekday (Mon = 1) → the RRULE token. */
export function weekdayOf(date: Temporal.PlainDate): Weekday {
  return WEEKDAYS[date.dayOfWeek - 1];
}

/**
 * Which ordinal of its weekday a date is within its month: the 2nd
 * Wednesday, the 4th Friday. Capped at 4 rather than running to 5,
 * because a "5th Wednesday" series would skip most months — an officer
 * picking a date in a 5-weekday month means the last one.
 */
export function ordinalWeekdayOf(date: Temporal.PlainDate): number {
  const ordinal = Math.floor((date.day - 1) / 7) + 1;
  return Math.min(ordinal, 4);
}

/**
 * Compile form state into an RRULE, or `null` for a one-off.
 *
 * `anchor` is the event's start date, which supplies the defaults the
 * form leaves implicit — the weekday of a plain weekly rule, and the
 * day-of-month or nth-weekday of a monthly one.
 */
export function buildRrule(
  state: RecurrenceFormState,
  anchor: Temporal.PlainDate,
): string | null {
  if (state.mode === "none") {
    return null;
  }

  const parts: string[] = [];
  parts.push(`FREQ=${state.mode === "weekly" ? "WEEKLY" : "MONTHLY"}`);
  if (state.interval > 1) {
    parts.push(`INTERVAL=${state.interval}`);
  }

  if (state.mode === "weekly") {
    // An empty selection means "the start's own weekday", which is what
    // the expander already defaults to — so emit nothing and let the
    // rule stay readable.
    if (state.weekdays.length > 0) {
      const ordered = WEEKDAYS.filter((day) => state.weekdays.includes(day));
      parts.push(`BYDAY=${ordered.join(",")}`);
    }
  } else if (state.monthlyMode === "nthWeekday") {
    parts.push(`BYDAY=${ordinalWeekdayOf(anchor)}${weekdayOf(anchor)}`);
  }

  if (state.endMode === "count") {
    parts.push(`COUNT=${state.count}`);
  } else if (state.endMode === "until" && state.untilDate !== "") {
    parts.push(`UNTIL=${toUntilStamp(state.untilDate)}`);
  }

  return parts.join(";");
}

/**
 * `YYYY-MM-DD` → RFC 5545's UTC stamp, at the END of that club-local
 * day.
 *
 * End-of-day, not midnight, because an officer who says "repeats until
 * May 20" means the May 20 meeting happens. Anchoring at midnight would
 * drop it, and the officer would have no way to tell from the form why.
 */
export function toUntilStamp(untilDate: string): string {
  const instant = Temporal.PlainDate.from(untilDate)
    .toPlainDateTime({ hour: 23, minute: 59, second: 59 })
    .toZonedDateTime(CLUB_TIME_ZONE)
    .toInstant();
  const utc = instant.toZonedDateTimeISO("UTC");
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(utc.year, 4)}${pad(utc.month)}${pad(utc.day)}T${pad(utc.hour)}${pad(utc.minute)}${pad(utc.second)}Z`;
}

/**
 * Decompile a stored rule back into form state, for the edit dialog.
 *
 * An unparseable rule falls back to "does not repeat" rather than
 * throwing: the dialog has to open. That can only happen for a rule
 * written before the subset tightened, and the officer sees the repeat
 * controls in their default state rather than a broken dialog.
 */
export function parseRruleToForm(rrule: string | null): RecurrenceFormState {
  if (rrule === null || rrule === "") {
    return EMPTY_RECURRENCE;
  }

  let rule;
  try {
    rule = parseRrule(rrule);
  } catch {
    return EMPTY_RECURRENCE;
  }

  const ordinalTerms = rule.byDay.filter((term) => term.ordinal !== null);
  return {
    mode: rule.freq === "WEEKLY" ? "weekly" : "monthly",
    interval: rule.interval,
    weekdays:
      rule.freq === "WEEKLY" ? rule.byDay.map((term) => term.weekday) : [],
    monthlyMode: ordinalTerms.length > 0 ? "nthWeekday" : "dayOfMonth",
    endMode:
      rule.count !== null ? "count" : rule.until !== null ? "until" : "never",
    untilDate:
      rule.until === null
        ? ""
        : rule.until
            .toZonedDateTimeISO(CLUB_TIME_ZONE)
            .toPlainDate()
            .toString(),
    count: rule.count ?? EMPTY_RECURRENCE.count,
  };
}

/** One-line summary of a rule, shown under the repeat controls. */
export function describeRecurrence(
  state: RecurrenceFormState,
  anchor: Temporal.PlainDate,
): string {
  if (state.mode === "none") {
    return "Happens once.";
  }

  const every =
    state.interval === 1
      ? state.mode === "weekly"
        ? "Every week"
        : "Every month"
      : `Every ${state.interval} ${state.mode === "weekly" ? "weeks" : "months"}`;

  let on: string;
  if (state.mode === "weekly") {
    const days =
      state.weekdays.length > 0
        ? WEEKDAYS.filter((day) => state.weekdays.includes(day))
        : [weekdayOf(anchor)];
    on = ` on ${days.map((day) => WEEKDAY_NAME[day]).join(", ")}`;
  } else if (state.monthlyMode === "nthWeekday") {
    on = ` on the ${ORDINAL_NAME[ordinalWeekdayOf(anchor)]} ${WEEKDAY_NAME[weekdayOf(anchor)]}`;
  } else {
    on = ` on day ${anchor.day}`;
  }

  const ending =
    state.endMode === "count"
      ? `, ${state.count} times`
      : state.endMode === "until" && state.untilDate !== ""
        ? `, until ${state.untilDate}`
        : "";

  return `${every}${on}${ending}.`;
}

const WEEKDAY_NAME: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

const ORDINAL_NAME: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "last",
};
