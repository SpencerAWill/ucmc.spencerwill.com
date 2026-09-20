/**
 * Display labels and badge variants for the gear state enums.
 *
 * These lived as private copies in six components, which is how
 * `condition` ended up rendering "Missing" in one place and "Lost" in
 * another for the same row. One definition per enum here, so adding a
 * value is a compile error at every call site instead of a silent
 * `undefined` in a badge.
 *
 * Member-facing wording deliberately differs from the storage names:
 * `whereabouts: "cave"` reads as "In the cave", and every terminal
 * status reads as its own word rather than a shared "Inactive".
 */
import type { Temporal } from "temporal-polyfill";

import {
  AVAILABILITY_LABEL,
  AVAILABILITY_VARIANT,
} from "#/features/gear/lib/availability";
import type { GearAvailability } from "#/features/gear/lib/availability";
import type {
  GearAcquisitionKind,
  GearAttributeKind,
  GearAttributeLevel,
  GearCondition,
  GearStatus,
  GearTracking,
  GearWhereabouts,
} from "#/features/gear/server/gear-fns";
import { formatDate, formatRelative } from "#/lib/date-format";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export const STATUS_LABEL: Record<GearStatus, string> = {
  active: "Active",
  retired: "Retired",
  lost: "Lost",
  disposed: "Disposed",
};

export const STATUS_VARIANT: Record<GearStatus, BadgeVariant> = {
  active: "secondary",
  retired: "outline",
  lost: "destructive",
  disposed: "outline",
};

export const CONDITION_LABEL: Record<GearCondition, string> = {
  serviceable: "Serviceable",
  needs_repair: "Needs repair",
  unsafe: "Unsafe",
};

/** `unsafe` is the only condition that is destructive-by-default: it is
 *  a hard loan block with no override, and it should read that way. */
export const CONDITION_VARIANT: Record<GearCondition, BadgeVariant> = {
  serviceable: "secondary",
  needs_repair: "outline",
  unsafe: "destructive",
};

export const WHEREABOUTS_LABEL: Record<GearWhereabouts, string> = {
  cave: "In the cave",
  repair: "At repair",
  officer: "With an officer",
  missing: "Missing",
};

export const WHEREABOUTS_VARIANT: Record<GearWhereabouts, BadgeVariant> = {
  cave: "secondary",
  repair: "outline",
  officer: "outline",
  missing: "destructive",
};

export const TRACKING_LABEL: Record<GearTracking, string> = {
  coded: "Individually coded",
  counted: "Counted stock",
};

export const ACQUISITION_KIND_LABEL: Record<GearAcquisitionKind, string> = {
  purchased: "Purchased",
  donated: "Donated",
  found: "Found",
  warranty_replacement: "Warranty replacement",
};

/** Terminal statuses, for the "deactivate" picker. `active` is reached
 *  by reactivating, never by choosing it here. */
export const ATTRIBUTE_KIND_LABEL: Record<GearAttributeKind, string> = {
  text: "Free text",
  number: "Number",
  select: "Choice list",
  boolean: "Yes / no",
};

export const ATTRIBUTE_LEVEL_LABEL: Record<GearAttributeLevel, string> = {
  model: "Every unit of a model",
  item: "Each piece",
};

/** The distinction officers get wrong the first time, phrased as the
 *  consequence rather than the taxonomy. */
export const ATTRIBUTE_LEVEL_HINT: Record<GearAttributeLevel, string> = {
  model: "Answered once for the model — rope diameter, stove fuel.",
  item: "Answered per piece — harness size, rope length after a cut.",
};

/**
 * What to call a piece that has no distinguishing marks of its own.
 *
 * The product's full name, brand included. Five DTO mappers had spelled
 * this `description ?? modelName`, dropping the manufacturer — so the
 * list read "Corax" six times over while the models view a tab away
 * read "Petzl Corax", and `/gear/loans` read a third thing again.
 */
export function gearFallbackName(model: {
  manufacturer: string | null;
  name: string;
}): string {
  return model.manufacturer
    ? `${model.manufacturer} ${model.name}`
    : model.name;
}

export const TERMINAL_STATUSES = ["retired", "lost", "disposed"] as const;
export type TerminalGearStatus = (typeof TERMINAL_STATUSES)[number];

/**
 * "Is this still club property?" — the question `status` answers.
 *
 * Every surface that offers Retire / Reactivate asks it, and each one
 * used to spell it `status === "retired"`, which silently excluded the
 * other two terminal statuses: an item written off as `lost` was
 * offered "Retire" and had no way back to active at all.
 */
export function isTerminalStatus(
  status: GearStatus,
): status is TerminalGearStatus {
  return status !== "active";
}

/**
 * What the availability badge should actually say.
 *
 * `gearAvailability` collapses `retired`, `lost` and `disposed` into
 * one `retired` bucket, which is the right answer to "can I borrow
 * this" and the wrong word on a card: a harness the club wrote off as
 * lost should not read "Retired" everywhere. The rollup keeps its five
 * values — the filter is built on them — and the label reaches past it
 * to the raw status for that one bucket.
 */
export function availabilityBadge(gear: {
  status: GearStatus;
  availability: GearAvailability;
  availableFrom?: Temporal.Instant | null;
}): { label: string; variant: BadgeVariant } {
  if (gear.availability === "retired") {
    return {
      label: STATUS_LABEL[gear.status],
      variant: STATUS_VARIANT[gear.status],
    };
  }
  // A loan whose date has passed is not "On loan" in the neutral sense
  // the rollup means — the desk is chasing it. `/gear/loans` and
  // `/my/gear` already say so; the gear surfaces used to render the
  // same loan as a calm "back Sep 8" on a date two weeks gone.
  if (gear.availability === "on_loan" && isOverdue(gear.availableFrom)) {
    return { label: "Overdue", variant: "destructive" };
  }
  return {
    label: AVAILABILITY_LABEL[gear.availability],
    variant: AVAILABILITY_VARIANT[gear.availability],
  };
}

/**
 * Is a loan's return date in the past?
 *
 * Compared against the wall clock at render time, matching `LoanCard`
 * and `MyGearList`, which each spelled this out inline. A loan that
 * crosses the boundary between SSR and hydration re-renders with the
 * other badge, which is the same trade those two already make.
 */
export function isOverdue(dueAt: Temporal.Instant | null | undefined): boolean {
  if (dueAt === null || dueAt === undefined) {
    return false;
  }
  return dueAt.epochMilliseconds < Date.now();
}

/**
 * The half-sentence that goes next to an availability badge.
 *
 * The badge answers "can I take this out"; this answers "so when, or
 * why not". Without it `Unavailable` was the whole story for a piece at
 * the repair shop, missing, or out with an officer — the three cases a
 * member most needs explained, and the only ones with no condition
 * badge beside them to explain it.
 */
export function availabilityNote(gear: {
  availability: GearAvailability;
  availableFrom: Temporal.Instant | null;
  whereabouts: GearWhereabouts;
  holdReason: string | null;
}): string | null {
  if (gear.availability === "on_loan" && gear.availableFrom !== null) {
    return isOverdue(gear.availableFrom)
      ? `was due ${formatRelative(gear.availableFrom)}`
      : `back ${formatDate(gear.availableFrom)}`;
  }
  if (gear.availability === "on_hold") {
    return gear.holdReason;
  }
  if (gear.availability === "unavailable" && gear.whereabouts !== "cave") {
    return WHEREABOUTS_LABEL[gear.whereabouts].toLowerCase();
  }
  return null;
}
