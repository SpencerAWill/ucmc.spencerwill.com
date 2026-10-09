/**
 * `/calendar`'s URL state (issue #187).
 *
 * The month, the selected range and the type filter all live in the
 * query string, so a reader can link to what they are looking at —
 * "the calendar, filtered to trips, that weekend" — and the back
 * button walks their filtering rather than leaving the page. That is
 * the same call the `/my` tab bar made: a real URL rather than
 * component state, so direct navigation, shareable links and
 * back/forward all keep working.
 *
 * Everything is **optional and individually recoverable**. A URL
 * someone hand-edited, or one from a build where the vocabulary has
 * since changed, must still open the calendar — on today's month with
 * no filter — rather than erroring. `validateSearch` throwing would
 * turn a stale link in a two-year-old GroupMe message into a crash.
 */
import { z } from "zod";

import { eventKind } from "#/../drizzle/schema";
import type { EventKind } from "#/../drizzle/schema";

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM` that `Temporal.PlainYearMonth` will actually accept.
 *
 * The regex alone is not enough — it admits `0000-01` — so the parse is
 * attempted and a failure drops the parameter rather than propagating.
 */
function plainYearMonthOrUndefined(
  value: string | undefined,
): string | undefined {
  if (value === undefined || !YEAR_MONTH.test(value)) {
    return undefined;
  }
  try {
    Temporal.PlainYearMonth.from(value);
    return value;
  } catch {
    return undefined;
  }
}

function plainDateOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined || !ISO_DATE.test(value)) {
    return undefined;
  }
  try {
    Temporal.PlainDate.from(value);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Kinds as one comma-delimited parameter (`kind=meeting,trip`) rather
 * than a repeated or JSON-encoded one.
 *
 * It reads as something a person could have typed, which matters for a
 * URL people paste to each other, and it keeps the serialized form
 * stable: sorted, so the same selection always produces the same link
 * rather than one per click order.
 *
 * **The parsed form is the same string, not an array.** That is
 * deliberate and was a bug the first time: emitting an array here made
 * the router JSON-encode it (`kind=%5B%22trip%22%5D`), which this
 * parser then rejected as "not a string" and dropped — so every filter
 * click navigated to a URL that silently lost the filter. Keeping one
 * representation on both sides makes the round trip an identity, and
 * {@link kindsFromSearch} is the one place it becomes a list.
 *
 * A repeated parameter (`?kind=trip&kind=meeting`) is accepted too,
 * since the router hands those over as an array and someone editing a
 * URL by hand may well write one. Unknown values are dropped rather
 * than rejected: a link naming a kind that has since been renamed
 * should still open the calendar.
 */
function normalizeKinds(value: unknown): string | undefined {
  const parts =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value.filter((part): part is string => typeof part === "string")
        : [];

  const allowed = new Set<string>(eventKind);
  const kinds = parts
    .flatMap((part) => part.split(","))
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is EventKind => allowed.has(part));

  const unique = [...new Set(kinds)].sort();
  return unique.length > 0 ? unique.join(",") : undefined;
}

/** The parsed `kind` parameter as a list, for the components. */
export function kindsFromSearch(kind: string | undefined): EventKind[] {
  if (kind === undefined || kind === "") {
    return [];
  }
  const allowed = new Set<string>(eventKind);
  return kind.split(",").filter((part): part is EventKind => allowed.has(part));
}

export const calendarSearchSchema = z
  .object({
    month: z.unknown(),
    from: z.unknown(),
    to: z.unknown(),
    kind: z.unknown(),
  })
  .partial()
  .transform((raw) => {
    const from = plainDateOrUndefined(
      typeof raw.from === "string" ? raw.from : undefined,
    );
    const to = plainDateOrUndefined(
      typeof raw.to === "string" ? raw.to : undefined,
    );

    return {
      month: plainYearMonthOrUndefined(
        typeof raw.month === "string" ? raw.month : undefined,
      ),
      from,
      // A `to` with no `from` is meaningless, and a reversed pair is
      // someone's hand-edit — in both cases the range is dropped rather
      // than guessed at, leaving the month view intact.
      to: from !== undefined && to !== undefined && to >= from ? to : undefined,
      kind: normalizeKinds(raw.kind),
    };
  });

export type CalendarSearch = z.output<typeof calendarSearchSchema>;

/**
 * Search params for a given view, with defaults omitted.
 *
 * Leaving the current month out keeps `/calendar` itself the canonical
 * "what's on now" link, rather than every visit rewriting it to a dated
 * one that ages badly the moment it is shared.
 */
export function calendarSearchFor(options: {
  month: Temporal.PlainYearMonth;
  currentMonth: Temporal.PlainYearMonth;
  range?: { from: Temporal.PlainDate; to: Temporal.PlainDate | null } | null;
  kinds: readonly EventKind[];
}): CalendarSearch {
  const isCurrent =
    Temporal.PlainYearMonth.compare(options.month, options.currentMonth) === 0;

  return {
    month: isCurrent ? undefined : options.month.toString(),
    from: options.range ? options.range.from.toString() : undefined,
    to: options.range?.to ? options.range.to.toString() : undefined,
    // Through the same normalizer the parser uses, so what is written
    // and what is read back can never disagree.
    kind: normalizeKinds([...options.kinds]),
  };
}
