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
import type {
  GearAcquisitionKind,
  GearAttributeKind,
  GearAttributeLevel,
  GearCondition,
  GearStatus,
  GearTracking,
  GearWhereabouts,
} from "#/features/gear/server/gear-fns";

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

export const TERMINAL_STATUSES = ["retired", "lost", "disposed"] as const;
export type TerminalGearStatus = (typeof TERMINAL_STATUSES)[number];
