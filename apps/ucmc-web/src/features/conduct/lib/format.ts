import type { ScocState } from "#/../drizzle/schema";
import { CLUB_TIME_ZONE } from "#/config/time";
import { formatPlainDate } from "#/lib/date-format";

// Hoisted to `#/lib/date-format` so `features/trips` can use it too.
export { formatPlainDate };

export function formatDateRange(
  startsOn: Temporal.PlainDate | null,
  endsOn: Temporal.PlainDate | null,
): string {
  if (startsOn && endsOn) {
    return `${formatPlainDate(startsOn)} to ${formatPlainDate(endsOn)}`;
  }
  if (startsOn) {
    return `From ${formatPlainDate(startsOn)}`;
  }
  return "";
}

export const SCOC_STATE_LABELS: Record<ScocState, string> = {
  none: "Not referred",
  referred: "Referred to SCCS",
  returned: "Returned by SCCS",
  sccs_sanctioned: "Sanctioned by SCCS",
};

/**
 * An instant as a calendar date in the club's zone, so the server render
 * and the browser agree whatever zone each runs in.
 */
export function formatClubDate(instant: Temporal.Instant): string {
  return instant.toLocaleString(undefined, {
    dateStyle: "medium",
    timeZone: CLUB_TIME_ZONE,
  });
}
