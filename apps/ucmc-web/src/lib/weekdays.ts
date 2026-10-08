/**
 * Weekday names ⇄ ISO weekday numbers.
 *
 * **ISO numbering throughout: Monday = 1 … Sunday = 7**, which is what
 * `Temporal.PlainDate.prototype.dayOfWeek` returns. JavaScript's
 * `Date.prototype.getDay()` is a *different* numbering (Sunday = 0), and
 * the two agree on Monday–Saturday and disagree only on Sunday — a
 * coincidence that makes a mixed-convention bug invisible in testing
 * right up until somebody configures Sunday. Convert at the boundary
 * with `isoWeekdayFromDate` rather than passing a `getDay()` result into
 * anything here.
 *
 * Lives in `src/lib/` because both sides of a site setting need it: the
 * settings registry validates the stored string, and the gear feature
 * parses it to pick a default due date. Shared, pure, feature-blind.
 */

/** Indexed by ISO weekday minus one, so `WEEKDAY_NAMES[0]` is Monday. */
export const WEEKDAY_NAMES = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/** ISO weekday for a JS `Date`, mapping `getDay()`'s Sunday-0 onto Sunday-7. */
export function isoWeekdayFromDate(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/**
 * Parse a comma-separated weekday list into sorted, de-duplicated ISO
 * weekday numbers. Returns `null` when any token isn't a weekday, which
 * is what lets a Zod `.refine()` and the runtime reader share one
 * definition of "valid".
 *
 * Case-insensitive, and tolerant of full names (`Wednesday`) and of
 * surrounding whitespace, because this is typed into a free-text settings
 * row by hand. An empty or whitespace-only string parses to `[]` rather
 * than failing — that is the meaningful "no open days configured" value
 * (the summer, when there are no cave hours at all), not a typo.
 */
export function parseWeekdayList(raw: string): number[] | null {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  const days = new Set<number>();
  for (const token of trimmed.split(",")) {
    const name = token.trim().toLowerCase();
    // `startsWith` on the three-letter form accepts both `Wed` and
    // `Wednesday` without a second lookup table. It also accepts
    // `Wednesdays`, which is what somebody writing out the cave's hours
    // actually types. The length guard is what stops a single letter
    // from resolving: `S` is ambiguous between Sat and Sun, and a
    // findIndex would silently pick whichever comes first.
    const index =
      name.length < 3
        ? -1
        : WEEKDAY_NAMES.findIndex((candidate) =>
            name.startsWith(candidate.toLowerCase()),
          );
    if (index === -1) return null;
    days.add(index + 1);
  }
  return [...days].sort((a, b) => a - b);
}

/** Inverse of `parseWeekdayList` — "Mon,Wed" for `[1, 3]`. */
export function formatWeekdayList(days: readonly number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_NAMES[day - 1])
    .join(",");
}
