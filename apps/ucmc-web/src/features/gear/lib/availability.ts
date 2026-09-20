/**
 * The availability rollup — the one facet a member actually browses by.
 *
 * Four independent axes (`status`, `condition`, `whereabouts`, and the
 * open loan derived from `gear_loans`) collapse into a single answer to
 * "can I borrow this?". Officers still see the raw axes; members see
 * this. Getting the collapse right is most of what makes the gear page
 * usable, which is why it lives in one pure function with the ordering
 * written down rather than being re-derived per component.
 *
 * Pure and client-safe: the list payload carries the inputs, so cards,
 * filters and the desk all agree without another round-trip.
 */
import type {
  CheckoutSkipReason,
  GearCondition,
  GearStatus,
  GearWhereabouts,
} from "#/features/gear/server/gear-fns";

export const GEAR_AVAILABILITY = [
  "available",
  "on_loan",
  "on_hold",
  "unavailable",
  "retired",
] as const;
export type GearAvailability = (typeof GEAR_AVAILABILITY)[number];

export interface AvailabilityInput {
  status: GearStatus;
  condition: GearCondition;
  whereabouts: GearWhereabouts;
  hasOpenLoan: boolean;
  hasActiveHold: boolean;
}

/**
 * Precedence is deliberate and not arbitrary:
 *
 *   1. `retired` first — a terminal status outranks everything. A lost
 *      harness that was also flagged for repair is simply gone.
 *   2. `on_loan` next, because it is the only state that resolves by
 *      itself on a known date. "Back Thursday" is more useful to a
 *      member than "needs repair", and the borrower may well be the one
 *      who reported the damage at check-in.
 *   3. `unavailable` for anything the cave has to act on — unsafe,
 *      needs repair, at the shop, missing.
 *   4. `on_hold` last of the blocking states: a hold is the softest, it
 *      is officer-overridable, and it expires on its own.
 */
export function gearAvailability(input: AvailabilityInput): GearAvailability {
  if (input.status !== "active") return "retired";
  if (input.hasOpenLoan) return "on_loan";
  if (input.condition !== "serviceable") return "unavailable";
  if (input.whereabouts !== "cave") return "unavailable";
  if (input.hasActiveHold) return "on_hold";
  return "available";
}

export const AVAILABILITY_LABEL: Record<GearAvailability, string> = {
  available: "Available",
  on_loan: "On loan",
  on_hold: "On hold",
  unavailable: "Unavailable",
  retired: "Retired",
};

export const AVAILABILITY_VARIANT: Record<
  GearAvailability,
  "default" | "secondary" | "destructive" | "outline"
> = {
  available: "default",
  on_loan: "outline",
  on_hold: "outline",
  unavailable: "destructive",
  retired: "secondary",
};

/**
 * Why a specific member can't take a specific item right now.
 *
 * Separate from `GearAvailability` because it answers a different
 * question: availability is a property of the item, this is a property
 * of the pairing. A greyed-out button with no explanation is the classic
 * complaint about club gear systems, so every refusal has a reason
 * string attached to it.
 */
export const CHECKOUT_BLOCKED_REASONS = [
  "retired",
  "on_loan",
  "unsafe",
  "needs_repair",
  "not_in_cave",
  "on_hold",
  "no_code",
  "not_waiver_current",
  "has_overdue",
] as const;
export type CheckoutBlockedReason = (typeof CHECKOUT_BLOCKED_REASONS)[number];

export const BLOCKED_REASON_MESSAGE: Record<CheckoutBlockedReason, string> = {
  retired: "This piece has been retired from the collection.",
  on_loan: "Someone else has this out right now.",
  unsafe: "Flagged unsafe — it can't go out until it's been inspected.",
  needs_repair: "Flagged for repair. An officer can override at the desk.",
  not_in_cave: "Not in the cave at the moment.",
  on_hold: "Held for a trip. An officer can override at the desk.",
  no_code: "No tag on this piece yet, so the desk can't scan it out.",
  not_waiver_current: "Your waiver needs renewing for this club year.",
  has_overdue: "You have gear that's overdue. Bring it back to borrow more.",
};

/**
 * `needs_repair` and `on_hold` are the two an officer may override with
 * a confirm; everything else is a hard stop. `unsafe` is deliberately
 * NOT overridable — a cored sheath never goes out, whoever is asking.
 */
export function isOverridableBlock(reason: CheckoutBlockedReason): boolean {
  return reason === "needs_repair" || reason === "on_hold";
}

/** The two flags `checkoutLoansAction` accepts, both `gear:manage`-gated
 *  and both recorded on the resulting audit event. */
export type CheckoutOverrideFlag = "overrideStanding" | "overrideHolds";

/**
 * Which desk refusals an officer may override, and the flag each one
 * wants on the retry.
 *
 * Deliberately a separate table from `isOverridableBlock` above, not a
 * re-derivation of it: that one answers "can this member take this
 * item", in the item's vocabulary, before a submit. This one answers
 * "can the desk push this batch through anyway", in the server's
 * post-submit skip vocabulary, where `member_blocked` is a property of
 * the whole batch and `on_hold` of one row. Everything absent here is
 * a hard stop — a retired piece does not come back because an officer
 * clicked twice.
 */
export const SKIP_OVERRIDE_FLAG: Partial<
  Record<CheckoutSkipReason, CheckoutOverrideFlag>
> = {
  on_hold: "overrideHolds",
  member_blocked: "overrideStanding",
};
