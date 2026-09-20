/**
 * TanStack Query keys for the gear feature. Centralized so query
 * options and mutation hooks always invalidate the same prefix. The
 * list / detail / types / tags / suggested-code surfaces each get their
 * own key so unrelated mutations don't blow the whole gear cache away.
 */

export const GEAR_QUERY_KEY = ["gear", "list"] as const;

/** The whole detail namespace. A mutation that changes many items at
 *  once — a model rename, a sweep close — can't enumerate the ids it
 *  touched, so it invalidates the prefix; per-item mutations still pin
 *  `gearDetailQueryKey`. */
export const GEAR_DETAIL_QUERY_KEY = ["gear", "detail"] as const;

export const gearDetailQueryKey = (publicId: string) =>
  [...GEAR_DETAIL_QUERY_KEY, publicId] as const;

export const GEAR_TYPES_QUERY_KEY = ["gear", "types"] as const;

export const GEAR_TAGS_QUERY_KEY = ["gear", "tags"] as const;

/** Attribute definitions, scoped by type the way the picker asks for
 *  them — `null` is the unscoped "every definition" list the manage
 *  dialog reads. */
export const GEAR_ATTRIBUTE_DEFS_QUERY_KEY = ["gear", "attributeDefs"] as const;
export function gearAttributeDefsQueryKey(input: {
  typePublicId?: string | null;
  level?: string | null;
  includeArchived?: boolean;
}) {
  return [
    ...GEAR_ATTRIBUTE_DEFS_QUERY_KEY,
    input.typePublicId ?? "all",
    input.level ?? "any",
    input.includeArchived === true,
  ] as const;
}

/** Sweeps. The open sweep and the history share a prefix: closing one
 *  changes both. */
export const GEAR_SWEEPS_QUERY_KEY = ["gear", "sweeps"] as const;
export const OPEN_SWEEP_QUERY_KEY = ["gear", "sweeps", "open"] as const;
/** Untagged pieces the open sweep can still log. Sits under the sweeps
 *  prefix so logging one, or closing the sweep, refreshes it. */
export const UNCODED_SWEEP_CANDIDATES_QUERY_KEY = [
  "gear",
  "sweeps",
  "uncoded",
] as const;
export const sweepDetailQueryKey = (publicId: string) =>
  ["gear", "sweeps", "detail", publicId] as const;

/** Holds. The prefix is invalidated wholesale on any hold change —
 *  placing one on an item also changes the "all live holds" list. */
export const GEAR_HOLDS_QUERY_KEY = ["gear", "holds"] as const;
export function gearHoldsQueryKey(input: {
  liveOnly?: boolean;
  gearPublicId?: string | null;
  modelPublicId?: string | null;
}) {
  return [
    ...GEAR_HOLDS_QUERY_KEY,
    input.liveOnly === true,
    input.gearPublicId ?? "all",
    input.modelPublicId ?? "all",
  ] as const;
}

export const gearSuggestedCodeQueryKey = (typePublicId: string) =>
  ["gear", "suggestedCode", typePublicId] as const;

export const gearInspectionsQueryKey = (gearPublicId: string) =>
  ["gear", "inspections", gearPublicId] as const;

export const gearLabelsQueryKey = (publicIds: readonly string[]) =>
  ["gear", "labels", [...publicIds].sort().join(",")] as const;

// ── loans ──────────────────────────────────────────────────────────────

export const LOANS_QUERY_KEY = ["gear", "loans", "list"] as const;

export const loanDetailQueryKey = (publicId: string) =>
  ["gear", "loans", "detail", publicId] as const;

export const MY_LOANS_QUERY_KEY = ["gear", "loans", "mine"] as const;

// ── cart ───────────────────────────────────────────────────────────────

export const MY_CART_QUERY_KEY = ["gear", "cart", "mine"] as const;

export const memberLoanSearchQueryKey = (q: string) =>
  ["gear", "loans", "search-members", q] as const;

export const memberForLoanByPublicIdQueryKey = (publicId: string) =>
  ["gear", "loans", "member", publicId] as const;

export const gearCodeSearchQueryKey = (q: string) =>
  ["gear", "loans", "search-gear-code", q] as const;

/** Models are scoped by type in the picker, so the key carries it —
 *  `null` is the unscoped "every model" list. */
export const GEAR_MODELS_QUERY_KEY = ["gear-models"] as const;
export function gearModelsQueryKey(typePublicId: string | null) {
  return [...GEAR_MODELS_QUERY_KEY, typePublicId ?? "all"] as const;
}

/** Browse-by-model. Under the models prefix so a model edit refreshes
 *  it, but keyed separately — the counts move with loans and holds,
 *  not just with the model row. */
export function gearModelBrowseQueryKey(input: {
  typePublicId?: string | null;
  q?: string;
}) {
  return [
    ...GEAR_MODELS_QUERY_KEY,
    "browse",
    input.typePublicId ?? "all",
    input.q ?? "",
  ] as const;
}
