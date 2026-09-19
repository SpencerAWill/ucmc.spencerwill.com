/**
 * The two derived safety clocks: when a piece is next due for
 * inspection, and when it reaches the end of its service life.
 *
 * Both are **derived, never stored**. Storing either would need a cron
 * to keep it true and a way for it to disagree with the inspection log
 * — the same reasoning that keeps loan state off the item row and
 * availability out of the database.
 *
 * Neither blocks checkout. `unsafe` is the hard block and an inspection
 * is what sets it; an overdue cadence means nobody has *looked*, which
 * is a job for the cave rather than a refusal at the desk. Making it a
 * block would strand a club that fell behind over a summer — exactly
 * when the gear most needs to keep moving. What these do is put the
 * backlog somewhere an officer can filter by it.
 *
 * Calendar arithmetic runs in club time for the same reason every other
 * date does: "due today" has to mean a calendar day has turned, not
 * that 24 hours elapsed since an instant.
 */
import { CLUB_TIME_ZONE } from "#/config/time";

export const INSPECTION_STATUS = [
  "ok",
  "due_soon",
  "overdue",
  "never",
  "untracked",
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUS)[number];

/** How long before the due date a piece starts reading as due soon.
 *  Two weeks is one meeting cycle plus slack — long enough that the
 *  backlog is workable at the next Wednesday, short enough that the
 *  list isn't permanently amber. */
export const DUE_SOON_DAYS = 14;

export interface InspectionInput {
  /** Resolved from the model, falling back to the type. Null means
   *  this kind of gear has no cadence, which is not a problem to
   *  report — a nut tool does not get inspected on a schedule. */
  intervalDays: number | null;
  lastInspectedAt: Temporal.Instant | null;
  now: Temporal.Instant;
  timeZone?: string;
}

export interface InspectionState {
  status: InspectionStatus;
  dueAt: Temporal.Instant | null;
  /** Negative when overdue, so a sort by this puts the worst first. */
  daysUntilDue: number | null;
}

export function inspectionState(input: InspectionInput): InspectionState {
  if (input.intervalDays === null) {
    return { status: "untracked", dueAt: null, daysUntilDue: null };
  }
  if (input.lastInspectedAt === null) {
    // Deliberately its own status rather than "overdue": a piece that
    // has never been inspected and one that is a week late are
    // different jobs, and the cave triages them differently.
    return { status: "never", dueAt: null, daysUntilDue: null };
  }
  const timeZone = input.timeZone ?? CLUB_TIME_ZONE;
  const dueDate = input.lastInspectedAt
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .add({ days: input.intervalDays });
  const today = input.now.toZonedDateTimeISO(timeZone).toPlainDate();
  const daysUntilDue = today.until(dueDate).days;
  const dueAt = dueDate
    .toZonedDateTime({
      timeZone,
      plainTime: new Temporal.PlainTime(23, 59, 59, 999),
    })
    .toInstant();
  return {
    status:
      daysUntilDue < 0
        ? "overdue"
        : daysUntilDue <= DUE_SOON_DAYS
          ? "due_soon"
          : "ok",
    dueAt,
    daysUntilDue,
  };
}

export const SERVICE_LIFE_STATUS = [
  "ok",
  "expiring",
  "expired",
  "untracked",
  "unknown",
] as const;
export type ServiceLifeStatus = (typeof SERVICE_LIFE_STATUS)[number];

/** A year out is the point at which replacing something stops being an
 *  emergency and starts being a budget line, which is the decision this
 *  warning is actually for. */
export const EXPIRING_SOON_DAYS = 365;

export interface ServiceLifeInput {
  serviceLifeYears: number | null;
  /** Date of manufacture. The clock runs from here and **not** from
   *  acquisition: a rope bought in 2024 from old warehouse stock is as
   *  old as the day it was made. */
  manufacturedAt: Temporal.Instant | null;
  now: Temporal.Instant;
  timeZone?: string;
}

export interface ServiceLifeState {
  status: ServiceLifeStatus;
  expiresAt: Temporal.Instant | null;
  daysUntilExpiry: number | null;
}

export function serviceLifeState(input: ServiceLifeInput): ServiceLifeState {
  if (input.serviceLifeYears === null) {
    return { status: "untracked", expiresAt: null, daysUntilExpiry: null };
  }
  if (input.manufacturedAt === null) {
    // Distinct from `untracked`: this model *does* age out, we just
    // never read the date off the tag. That is a gap somebody can
    // close, so it should not look the same as "doesn't apply".
    return { status: "unknown", expiresAt: null, daysUntilExpiry: null };
  }
  const timeZone = input.timeZone ?? CLUB_TIME_ZONE;
  const expiryDate = input.manufacturedAt
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .add({ years: input.serviceLifeYears });
  const today = input.now.toZonedDateTimeISO(timeZone).toPlainDate();
  const daysUntilExpiry = today.until(expiryDate).days;
  const expiresAt = expiryDate
    .toZonedDateTime({
      timeZone,
      plainTime: new Temporal.PlainTime(23, 59, 59, 999),
    })
    .toInstant();
  return {
    status:
      daysUntilExpiry < 0
        ? "expired"
        : daysUntilExpiry <= EXPIRING_SOON_DAYS
          ? "expiring"
          : "ok",
    expiresAt,
    daysUntilExpiry,
  };
}

export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  ok: "Inspection current",
  due_soon: "Inspection due soon",
  overdue: "Inspection overdue",
  never: "Never inspected",
  untracked: "No inspection cadence",
};

export const SERVICE_LIFE_STATUS_LABEL: Record<ServiceLifeStatus, string> = {
  ok: "Within service life",
  expiring: "Ageing out within a year",
  expired: "Past service life",
  untracked: "No service life",
  unknown: "Age unknown",
};

/** The statuses worth showing a badge for. `ok` and `untracked` are
 *  the quiet majority — badging them would make the list all badge and
 *  no signal. */
export function isSafetyFlag(
  status: InspectionStatus | ServiceLifeStatus,
): boolean {
  return (
    status === "overdue" ||
    status === "never" ||
    status === "due_soon" ||
    status === "expired" ||
    status === "expiring" ||
    status === "unknown"
  );
}
