import { CLUB_TIME_ZONE } from "#/config/time";
import type { ConductLevel, ConductReportStatus } from "#/../drizzle/schema";

type RetentionInput =
  | {
      kind: "report";
      status: ConductReportStatus;
      lastActivity: Temporal.Instant;
    }
  | {
      kind: "record";
      level: ConductLevel;
      endsOn: Temporal.PlainDate | null;
      liftedAt: Temporal.Instant | null;
      lastActivity: Temporal.Instant;
    };

function addYears(instant: Temporal.Instant, years: number): Temporal.Instant {
  return instant.toZonedDateTimeISO(CLUB_TIME_ZONE).add({ years }).toInstant();
}

function later(a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(a, b) >= 0 ? a : b;
}

/**
 * When a conduct report or record may be purged, or `null` for never.
 *
 * A dismissed report goes one year after dismissal. Everything else goes
 * five years after its last activity, its end date (the end of that day
 * in Cincinnati) or its lift, whichever is latest. An active termination
 * is kept indefinitely.
 */
export function retainUntil(input: RetentionInput): Temporal.Instant | null {
  if (input.kind === "report") {
    return addYears(input.lastActivity, input.status === "dismissed" ? 1 : 5);
  }
  if (input.level === "termination" && input.liftedAt === null) {
    return null;
  }
  const afterLift =
    input.liftedAt === null
      ? input.lastActivity
      : later(input.lastActivity, input.liftedAt);
  const base =
    input.endsOn === null
      ? afterLift
      : later(
          afterLift,
          input.endsOn
            .add({ days: 1 })
            .toZonedDateTime(CLUB_TIME_ZONE)
            .toInstant(),
        );
  return addYears(base, 5);
}
