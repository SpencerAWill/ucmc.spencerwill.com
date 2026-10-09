/**
 * The RRULE subset the club calendar supports, and its expander
 * (issue #187).
 *
 * **Why a hand-rolled expander rather than the `rrule` package.** That
 * package is `Date`-based and UTC-centric: its documented approach to
 * zoned recurrence is to compute in UTC and have the caller shift the
 * results. That fights this repo's Temporal-everywhere rule at exactly
 * the boundary that matters, because the one thing a club calendar must
 * get right is that a weekly 18:00 meeting is still at 18:00 after the
 * clocks change. It is also a dependency added for string parsing and
 * date arithmetic, against the `minimumReleaseAge` posture.
 *
 * **Recurrence here is calendar arithmetic, never instant arithmetic.**
 * Every occurrence is produced by stepping *dates* in
 * `CLUB_TIME_ZONE` and re-attaching the anchor's wall-clock time, so
 * the local time is preserved by construction. Adding `7 × 24h` to an
 * epoch would silently drift an hour across every DST transition —
 * `club-clock.test.ts` already pins that exact distinction for
 * retention windows, and `__tests__/recurrence.test.ts` pins it here.
 *
 * The supported subset, deliberately small:
 *
 *   FREQ=WEEKLY|MONTHLY  (required)
 *   INTERVAL=<n>         (optional, default 1)
 *   BYDAY=<MO,TU,…>      (weekly: which days; monthly: ordinal, e.g. 2WE)
 *   UNTIL=<utc stamp>    (optional)
 *   COUNT=<n>            (optional, mutually exclusive with UNTIL)
 *
 * Everything else RFC 5545 allows — BYMONTH, BYSETPOS, BYWEEKNO, daily
 * and yearly frequencies, WKST — is rejected rather than ignored.
 * Silently dropping a component we do not implement would produce a
 * feed whose occurrences disagree with the page, which is the single
 * worst failure mode available to this feature: the member's phone and
 * the website would each be confidently wrong in a different way.
 */
import { CLUB_TIME_ZONE } from "#/config/time";

export type RecurrenceFreq = "WEEKLY" | "MONTHLY";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** ISO day-of-week, matching `Temporal.PlainDate.dayOfWeek` (Mon = 1). */
const WEEKDAY_NUMBER: Record<Weekday, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

export interface ByDayTerm {
  /**
   * RFC 5545's ordinal prefix: `2WE` is the second Wednesday, `-1FR`
   * the last Friday. NULL means "every such weekday", the only form
   * allowed under FREQ=WEEKLY.
   */
  readonly ordinal: number | null;
  readonly weekday: Weekday;
}

export interface ParsedRecurrence {
  readonly freq: RecurrenceFreq;
  readonly interval: number;
  readonly byDay: readonly ByDayTerm[];
  readonly until: Temporal.Instant | null;
  readonly count: number | null;
}

/**
 * Thrown by {@link parseRrule} for anything outside the subset.
 *
 * A distinct class so the Zod schema can turn it into a field error
 * while an unexpected failure anywhere else still surfaces as a 500.
 */
export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurrenceError";
  }
}

/**
 * Hard ceiling on occurrences generated for one series in one window.
 *
 * A stop condition that does not depend on the rule being sane. Every
 * supported rule terminates on its own — a window has an end, and
 * UNTIL/COUNT bound the series — but this is a parser for officer-typed
 * input feeding a loop, and an unbounded loop in a Worker is a request
 * that never returns rather than an error anyone can see. Daily for a
 * decade is ~3650, so 5000 is far past any legitimate club schedule.
 */
const MAX_OCCURRENCES = 5000;

/** `20260408T193000Z` — the only UNTIL form RFC 5545 allows with a zoned DTSTART. */
const UNTIL_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

const BYDAY_PATTERN = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;

function parseUntil(raw: string): Temporal.Instant {
  const match = UNTIL_PATTERN.exec(raw);
  if (!match) {
    throw new RecurrenceError(
      `UNTIL must be a UTC timestamp like 20260408T193000Z, got "${raw}"`,
    );
  }
  const [, year, month, day, hour, minute, second] = match;
  try {
    return Temporal.ZonedDateTime.from({
      timeZone: "UTC",
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
    }).toInstant();
  } catch {
    throw new RecurrenceError(`UNTIL is not a real date: "${raw}"`);
  }
}

/**
 * Parse an RRULE string into the supported subset, or throw.
 *
 * Accepts the bare rule (`FREQ=WEEKLY;BYDAY=WE`) as well as the
 * `RRULE:`-prefixed form clients paste, since an officer copying a rule
 * out of another calendar gets the prefix and should not have to know
 * to strip it.
 */
export function parseRrule(input: string): ParsedRecurrence {
  const body = input.trim().replace(/^RRULE:/i, "");
  if (body.length === 0) {
    throw new RecurrenceError("Recurrence rule is empty");
  }

  const parts = new Map<string, string>();
  for (const segment of body.split(";")) {
    if (segment.length === 0) {
      continue;
    }
    const eq = segment.indexOf("=");
    if (eq <= 0) {
      throw new RecurrenceError(`Malformed rule segment: "${segment}"`);
    }
    const name = segment.slice(0, eq).toUpperCase();
    if (parts.has(name)) {
      throw new RecurrenceError(`Duplicate ${name} in recurrence rule`);
    }
    parts.set(name, segment.slice(eq + 1).toUpperCase());
  }

  const SUPPORTED = new Set(["FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT"]);
  for (const name of parts.keys()) {
    if (!SUPPORTED.has(name)) {
      throw new RecurrenceError(
        `${name} is not supported. Supported: FREQ, INTERVAL, BYDAY, UNTIL, COUNT.`,
      );
    }
  }

  const freqRaw = parts.get("FREQ");
  if (freqRaw !== "WEEKLY" && freqRaw !== "MONTHLY") {
    throw new RecurrenceError(
      `FREQ must be WEEKLY or MONTHLY, got "${freqRaw ?? "(missing)"}"`,
    );
  }
  const freq: RecurrenceFreq = freqRaw;

  const intervalRaw = parts.get("INTERVAL");
  const interval = intervalRaw === undefined ? 1 : Number(intervalRaw);
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
    throw new RecurrenceError(
      `INTERVAL must be a whole number from 1 to 52, got "${intervalRaw}"`,
    );
  }

  if (parts.has("UNTIL") && parts.has("COUNT")) {
    throw new RecurrenceError(
      "A rule may set UNTIL or COUNT, not both (RFC 5545 §3.3.10)",
    );
  }

  const countRaw = parts.get("COUNT");
  const count = countRaw === undefined ? null : Number(countRaw);
  if (
    count !== null &&
    (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES)
  ) {
    throw new RecurrenceError(
      `COUNT must be a whole number from 1 to ${MAX_OCCURRENCES}, got "${countRaw}"`,
    );
  }

  const untilRaw = parts.get("UNTIL");
  const until = untilRaw === undefined ? null : parseUntil(untilRaw);

  const byDayRaw = parts.get("BYDAY");
  const byDay: ByDayTerm[] = [];
  if (byDayRaw !== undefined && byDayRaw.length > 0) {
    for (const term of byDayRaw.split(",")) {
      const match = BYDAY_PATTERN.exec(term);
      if (!match) {
        throw new RecurrenceError(`Malformed BYDAY term: "${term}"`);
      }
      // Sliced rather than read out of the match groups: an unmatched
      // optional group is `undefined` at runtime while
      // `RegExpExecArray` types every element as `string`, so the
      // group-based version needs a cast to say something true. The
      // pattern has already proved the shape — a two-letter weekday
      // with an optional signed ordinal in front — so the split is
      // exact, and an absent ordinal is the empty string.
      const weekday = term.slice(-2) as Weekday;
      const ordinalRaw = term.slice(0, -2);
      const ordinal = ordinalRaw === "" ? null : Number(ordinalRaw);
      if (ordinal !== null && freq === "WEEKLY") {
        throw new RecurrenceError(
          `BYDAY may not carry an ordinal under FREQ=WEEKLY ("${term}")`,
        );
      }
      if (ordinal !== null && (ordinal === 0 || ordinal < -5 || ordinal > 5)) {
        throw new RecurrenceError(
          `BYDAY ordinal must be between -5 and 5 and non-zero ("${term}")`,
        );
      }
      byDay.push({ ordinal, weekday });
    }
  }

  return { freq, interval, byDay, until, count };
}

/**
 * Canonical string form, so what gets stored and emitted is normalized
 * rather than whatever the officer typed.
 *
 * Component order follows RFC 5545's own examples (FREQ first, bounds
 * last). Normalizing on write is what makes the stored value safe to
 * emit verbatim into a VEVENT — the feed never re-serializes, so a
 * client and the page are reading the same bytes.
 */
export function formatRrule(rule: ParsedRecurrence): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }
  if (rule.byDay.length > 0) {
    const terms = rule.byDay.map(
      (term) => `${term.ordinal ?? ""}${term.weekday}`,
    );
    parts.push(`BYDAY=${terms.join(",")}`);
  }
  if (rule.count !== null) {
    parts.push(`COUNT=${rule.count}`);
  }
  if (rule.until !== null) {
    const utc = rule.until.toZonedDateTimeISO("UTC");
    const pad = (n: number, width = 2) => String(n).padStart(width, "0");
    parts.push(
      `UNTIL=${pad(utc.year, 4)}${pad(utc.month)}${pad(utc.day)}T${pad(utc.hour)}${pad(utc.minute)}${pad(utc.second)}Z`,
    );
  }
  return parts.join(";");
}

/** Parse then re-emit, so storage holds the canonical spelling. */
export function normalizeRrule(input: string): string {
  return formatRrule(parseRrule(input));
}

/**
 * The dates a rule lands on, in club-local terms.
 *
 * Split out from {@link expandOccurrences} because it is the whole of
 * the calendar arithmetic: everything downstream just re-attaches a
 * wall-clock time and converts. Yields in ascending order and stops at
 * the first date past `windowEnd`.
 */
function* recurrenceDates(
  rule: ParsedRecurrence,
  anchor: Temporal.PlainDate,
  windowEnd: Temporal.PlainDate,
): Generator<Temporal.PlainDate> {
  if (rule.freq === "WEEKLY") {
    const days =
      rule.byDay.length > 0
        ? rule.byDay.map((term) => WEEKDAY_NUMBER[term.weekday])
        : [anchor.dayOfWeek];
    const ascending = [...new Set(days)].sort((a, b) => a - b);
    // WKST defaults to MO (RFC 5545 §3.3.10) and we do not accept an
    // override, so weeks are stepped from the Monday on or before the
    // anchor. Stepping from the anchor's own weekday instead would make
    // INTERVAL=2 with BYDAY=MO,WE produce the wrong alternating weeks
    // whenever the anchor is not itself a Monday.
    let weekStart = anchor.subtract({ days: anchor.dayOfWeek - 1 });
    for (;;) {
      for (const dayOfWeek of ascending) {
        const date = weekStart.add({ days: dayOfWeek - 1 });
        if (Temporal.PlainDate.compare(date, anchor) < 0) {
          continue;
        }
        if (Temporal.PlainDate.compare(date, windowEnd) > 0) {
          return;
        }
        yield date;
      }
      weekStart = weekStart.add({ weeks: rule.interval });
      if (Temporal.PlainDate.compare(weekStart, windowEnd) > 0) {
        return;
      }
    }
  }

  // MONTHLY.
  const ordinalTerms = rule.byDay.filter((term) => term.ordinal !== null);
  let monthStart = anchor.with({ day: 1 });
  for (;;) {
    const candidates: Temporal.PlainDate[] = [];
    if (ordinalTerms.length > 0) {
      for (const term of ordinalTerms) {
        const date = nthWeekdayOfMonth(
          monthStart,
          WEEKDAY_NUMBER[term.weekday],
          term.ordinal ?? 1,
        );
        if (date) {
          candidates.push(date);
        }
      }
    } else {
      // No BYDAY: repeat on the anchor's day-of-month. A month too
      // short simply has no occurrence — RFC 5545 §3.3.10's rule for
      // invalid dates is to skip them, NOT to clamp to the last day.
      // Clamping would quietly move "the 31st" to the 28th of February
      // and back again, which reads as the event drifting.
      try {
        candidates.push(
          monthStart.with({ day: anchor.day }, { overflow: "reject" }),
        );
      } catch {
        // Month is too short; no occurrence this cycle.
      }
    }

    candidates.sort(Temporal.PlainDate.compare);
    for (const date of candidates) {
      if (Temporal.PlainDate.compare(date, anchor) < 0) {
        continue;
      }
      if (Temporal.PlainDate.compare(date, windowEnd) > 0) {
        return;
      }
      yield date;
    }

    monthStart = monthStart.add({ months: rule.interval });
    if (Temporal.PlainDate.compare(monthStart, windowEnd) > 0) {
      return;
    }
  }
}

/** The nth (or -nth) given weekday within `monthStart`'s month, if it exists. */
function nthWeekdayOfMonth(
  monthStart: Temporal.PlainDate,
  dayOfWeek: number,
  ordinal: number,
): Temporal.PlainDate | null {
  if (ordinal > 0) {
    const offset = (dayOfWeek - monthStart.dayOfWeek + 7) % 7;
    const date = monthStart.add({ days: offset + (ordinal - 1) * 7 });
    return date.month === monthStart.month ? date : null;
  }
  const monthEnd = monthStart.with({ day: monthStart.daysInMonth });
  const offset = (monthEnd.dayOfWeek - dayOfWeek + 7) % 7;
  const date = monthEnd.subtract({ days: offset + (-ordinal - 1) * 7 });
  return date.month === monthStart.month ? date : null;
}

export interface OccurrenceSpan {
  /**
   * The occurrence's start as the series generates it — iCalendar's
   * `RECURRENCE-ID`, and the identity an `event_exceptions` row points
   * at. Stays put when an exception *moves* the occurrence, which is
   * what makes the override addressable.
   */
  readonly occurrenceStart: Temporal.Instant;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant | null;
}

/**
 * Expand a series into the occurrences overlapping `[from, until)`.
 *
 * A non-recurring series (`rrule === null`) yields exactly its own
 * span, so callers never branch on whether an event recurs.
 *
 * **Duration is preserved as wall-clock, not as elapsed time.** A
 * meeting that runs 18:00–19:00 runs 18:00–19:00 on the November
 * Sunday when the hour repeats, rather than 18:00–18:00. Exact-elapsed
 * would be the right call for a timeout or a retention window; for
 * something humans show up to, the local clock is the contract. The
 * distinction only bites for an event spanning a transition, which is
 * rare — and silently wrong in a way nobody would think to check.
 *
 * COUNT is evaluated from the series anchor, not from the window, so a
 * window opening halfway through a 10-occurrence series still reports
 * the right occurrences. That means counting forward from the anchor
 * even when the window is far in the future; {@link MAX_OCCURRENCES}
 * bounds the work.
 */
export function expandOccurrences(
  series: {
    startsAt: Temporal.Instant;
    endsAt: Temporal.Instant | null;
    rrule: string | null;
  },
  from: Temporal.Instant,
  until: Temporal.Instant,
): OccurrenceSpan[] {
  const anchorZdt = series.startsAt.toZonedDateTimeISO(CLUB_TIME_ZONE);

  // Wall-clock duration, measured in the club zone. `largestUnit: "hour"`
  // keeps it a clock quantity rather than a calendar one, so adding it
  // back cannot shift the occurrence onto a different date.
  const duration =
    series.endsAt === null
      ? null
      : anchorZdt
          .toPlainDateTime()
          .until(
            series.endsAt.toZonedDateTimeISO(CLUB_TIME_ZONE).toPlainDateTime(),
            {
              largestUnit: "hour",
            },
          );

  const spanFor = (start: Temporal.ZonedDateTime): OccurrenceSpan => ({
    occurrenceStart: start.toInstant(),
    startsAt: start.toInstant(),
    endsAt: duration === null ? null : start.add(duration).toInstant(),
  });

  if (series.rrule === null) {
    const span = spanFor(anchorZdt);
    const effectiveEnd = span.endsAt ?? span.startsAt;
    const overlaps =
      Temporal.Instant.compare(effectiveEnd, from) >= 0 &&
      Temporal.Instant.compare(span.startsAt, until) < 0;
    return overlaps ? [span] : [];
  }

  const rule = parseRrule(series.rrule);
  const wallTime = anchorZdt.toPlainTime();
  const anchorDate = anchorZdt.toPlainDate();
  // One day of slack so an occurrence that starts just before the
  // window's final instant is still generated.
  const windowEndDate = until
    .toZonedDateTimeISO(CLUB_TIME_ZONE)
    .toPlainDate()
    .add({ days: 1 });

  const out: OccurrenceSpan[] = [];
  let generated = 0;

  for (const date of recurrenceDates(rule, anchorDate, windowEndDate)) {
    // Re-attaching the anchor's wall time is what preserves 18:00
    // across a DST change. `toZonedDateTime` disambiguates a spring-
    // forward gap by pushing forward, which is what every calendar
    // client does with a nonexistent local time.
    const start = date
      .toPlainDateTime(wallTime)
      .toZonedDateTime(CLUB_TIME_ZONE);
    const instant = start.toInstant();

    if (
      rule.until !== null &&
      Temporal.Instant.compare(instant, rule.until) > 0
    ) {
      break;
    }
    generated += 1;
    if (rule.count !== null && generated > rule.count) {
      break;
    }
    if (generated > MAX_OCCURRENCES) {
      break;
    }

    if (Temporal.Instant.compare(instant, until) >= 0) {
      break;
    }
    const span = spanFor(start);
    const effectiveEnd = span.endsAt ?? span.startsAt;
    if (Temporal.Instant.compare(effectiveEnd, from) >= 0) {
      out.push(span);
    }
  }

  return out;
}
