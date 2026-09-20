/**
 * Query options factories for the gear feature. Each factory returns
 * `{ queryKey, queryFn }` shape so route loaders can call
 * `queryClient.ensureQueryData(...)` and components can call
 * `useQuery(...)` against the same key.
 */
import {
  GEAR_QUERY_KEY,
  GEAR_TAGS_QUERY_KEY,
  gearAttributeDefsQueryKey,
  gearHoldsQueryKey,
  GEAR_SWEEPS_QUERY_KEY,
  OPEN_SWEEP_QUERY_KEY,
  UNCODED_SWEEP_CANDIDATES_QUERY_KEY,
  sweepDetailQueryKey,
  gearModelBrowseQueryKey,
  gearModelsQueryKey,
  GEAR_TYPES_QUERY_KEY,
  LOANS_QUERY_KEY,
  MY_CART_QUERY_KEY,
  MY_LOANS_QUERY_KEY,
  gearCodeSearchQueryKey,
  gearDetailQueryKey,
  COUNTED_MODELS_FOR_INSPECTION_QUERY_KEY,
  gearInspectionsQueryKey,
  gearModelInspectionsQueryKey,
  gearLabelsQueryKey,
  gearSuggestedCodeQueryKey,
  loanDetailQueryKey,
  memberForLoanByPublicIdQueryKey,
  memberLoanSearchQueryKey,
} from "#/features/gear/api/query-keys";
import {
  getItemByCodeFn,
  getGearDetailFn,
  getLoanDetailFn,
  getMemberForLoanFn,
  getMyCartFn,
  listGearFn,
  listCountedModelsForInspectionFn,
  listGearInspectionsFn,
  listGearLabelsFn,
  listGearAttributeDefsFn,
  getOpenSweepFn,
  listUncodedSweepCandidatesFn,
  getSweepFn,
  listGearHoldsFn,
  listSweepsFn,
  listGearTagsFn,
  listGearModelBrowseFn,
  listGearModelsFn,
  listGearTypesFn,
  listLoansFn,
  listMyLoansFn,
  searchItemsByCodeFn,
  searchMembersForLoanFn,
  suggestCodeForTypeFn,
} from "#/features/gear/server/gear-fns";
import type {
  ListGearActionInput,
  ListLoansActionInput,
} from "#/features/gear/server/gear-fns";

export function gearListQueryOptions(input: ListGearActionInput = {}) {
  return {
    queryKey: [...GEAR_QUERY_KEY, input] as const,
    queryFn: () => listGearFn({ data: input }),
  } as const;
}

export function gearDetailQueryOptions(publicId: string) {
  return {
    queryKey: gearDetailQueryKey(publicId),
    queryFn: () => getGearDetailFn({ data: { publicId } }),
  } as const;
}

export function gearTypesQueryOptions() {
  return {
    queryKey: GEAR_TYPES_QUERY_KEY,
    queryFn: () => listGearTypesFn(),
  } as const;
}

export function gearModelsQueryOptions(typePublicId: string | null) {
  return {
    queryKey: gearModelsQueryKey(typePublicId),
    queryFn: () =>
      listGearModelsFn({
        data: typePublicId === null ? {} : { typePublicId },
      }),
  } as const;
}

/**
 * The member-facing shape of the gear page: one row per product, with
 * its units bucketed. `gear:read`, unlike `gearModelsQueryOptions`,
 * which is the officer's model admin list.
 */
export function gearModelBrowseQueryOptions(
  input: { typePublicId?: string | null; q?: string } = {},
) {
  return {
    queryKey: gearModelBrowseQueryKey(input),
    queryFn: () =>
      listGearModelBrowseFn({
        data: {
          ...(input.typePublicId ? { typePublicId: input.typePublicId } : {}),
          ...(input.q ? { q: input.q } : {}),
        },
      }),
  } as const;
}

export function gearTagsQueryOptions() {
  return {
    queryKey: GEAR_TAGS_QUERY_KEY,
    queryFn: () => listGearTagsFn(),
  } as const;
}

/**
 * Definitions for one type, or every definition when `typePublicId` is
 * null. The forms pass a type because the type is chosen by the time
 * the fields render; the manage dialog passes null and asks for the
 * archived ones too.
 */
export function gearAttributeDefsQueryOptions(
  input: {
    typePublicId?: string | null;
    level?: "model" | "item" | null;
    includeArchived?: boolean;
  } = {},
) {
  return {
    queryKey: gearAttributeDefsQueryKey(input),
    queryFn: () =>
      listGearAttributeDefsFn({
        data: {
          ...(input.typePublicId ? { typePublicId: input.typePublicId } : {}),
          ...(input.level ? { level: input.level } : {}),
          ...(input.includeArchived ? { includeArchived: true } : {}),
        },
      }),
  } as const;
}

export function gearHoldsQueryOptions(
  input: {
    liveOnly?: boolean;
    gearPublicId?: string | null;
    modelPublicId?: string | null;
  } = {},
) {
  return {
    queryKey: gearHoldsQueryKey(input),
    queryFn: () =>
      listGearHoldsFn({
        data: {
          ...(input.liveOnly ? { liveOnly: true } : {}),
          ...(input.gearPublicId ? { gearPublicId: input.gearPublicId } : {}),
          ...(input.modelPublicId
            ? { modelPublicId: input.modelPublicId }
            : {}),
        },
      }),
  } as const;
}

export function openSweepQueryOptions() {
  return {
    queryKey: OPEN_SWEEP_QUERY_KEY,
    queryFn: () => getOpenSweepFn(),
  } as const;
}

export function uncodedSweepCandidatesQueryOptions() {
  return {
    queryKey: UNCODED_SWEEP_CANDIDATES_QUERY_KEY,
    queryFn: () => listUncodedSweepCandidatesFn(),
  } as const;
}

export function sweepsQueryOptions() {
  return {
    queryKey: GEAR_SWEEPS_QUERY_KEY,
    queryFn: () => listSweepsFn(),
  } as const;
}

export function sweepDetailQueryOptions(publicId: string) {
  return {
    queryKey: sweepDetailQueryKey(publicId),
    queryFn: () => getSweepFn({ data: { publicId } }),
  } as const;
}

export function gearLabelsQueryOptions(publicIds: readonly string[]) {
  return {
    queryKey: gearLabelsQueryKey(publicIds),
    queryFn: () => listGearLabelsFn({ data: { publicIds: [...publicIds] } }),
    enabled: publicIds.length > 0,
  } as const;
}

export function gearInspectionsQueryOptions(gearPublicId: string) {
  return {
    queryKey: gearInspectionsQueryKey(gearPublicId),
    queryFn: () => listGearInspectionsFn({ data: { gearPublicId } }),
  } as const;
}

/** Every counted model, stalest first — the worklist a `gear:inspect`
 *  holder works out of. Narrower than the officer model list on
 *  purpose; see `listCountedModelsForInspectionAction`. */
export function countedModelsForInspectionQueryOptions() {
  return {
    queryKey: COUNTED_MODELS_FOR_INSPECTION_QUERY_KEY,
    queryFn: () => listCountedModelsForInspectionFn(),
  } as const;
}

/** The batch inspection log for a counted model — the same read, aimed
 *  at the other half of the row's item/model XOR. */
export function gearModelInspectionsQueryOptions(modelPublicId: string) {
  return {
    queryKey: gearModelInspectionsQueryKey(modelPublicId),
    queryFn: () => listGearInspectionsFn({ data: { modelPublicId } }),
  } as const;
}

/**
 * Reads the type's "next available code" suggestion. Driven by the
 * type's prefix + the max numeric suffix among active codes of that
 * type. UI-only sugar — the officer can always overwrite.
 */
export function gearSuggestedCodeQueryOptions(typePublicId: string | null) {
  return {
    queryKey: typePublicId
      ? gearSuggestedCodeQueryKey(typePublicId)
      : (["gear", "suggestedCode", null] as const),
    queryFn: typePublicId
      ? () => suggestCodeForTypeFn({ data: { typePublicId } })
      : async () => ({ suggestion: "" }),
    enabled: typePublicId !== null,
  } as const;
}

// ── loans ──────────────────────────────────────────────────────────────

export function loansListQueryOptions(input: ListLoansActionInput = {}) {
  return {
    queryKey: [...LOANS_QUERY_KEY, input] as const,
    queryFn: () => listLoansFn({ data: input }),
  } as const;
}

export function loanDetailQueryOptions(publicId: string) {
  return {
    queryKey: loanDetailQueryKey(publicId),
    queryFn: () => getLoanDetailFn({ data: { publicId } }),
  } as const;
}

export function myLoansQueryOptions() {
  return {
    queryKey: MY_LOANS_QUERY_KEY,
    queryFn: () => listMyLoansFn(),
  } as const;
}

/**
 * Member's gear cart at `/my/gear/cart`. The action's
 * `requireCartMember` gate enforces approved + current-waiver, so this
 * query 401s for waiver-lapsed users; the route-level guard catches
 * them before the query fires.
 */
export function myCartQueryOptions() {
  return {
    queryKey: MY_CART_QUERY_KEY,
    queryFn: () => getMyCartFn(),
  } as const;
}

/**
 * Debounced server-backed member search for the checkout combobox.
 * `enabled` filters out empty queries so we don't fire a request for
 * every keystroke before there's a needle.
 */
export function memberLoanSearchQueryOptions(q: string) {
  const trimmed = q.trim();
  return {
    queryKey: memberLoanSearchQueryKey(trimmed),
    queryFn: () => searchMembersForLoanFn({ data: { q: trimmed } }),
    enabled: trimmed.length > 0,
  } as const;
}

/**
 * Resolve a member's display info from a publicId. Used to hydrate
 * the loan-filter chip on page refresh — URL keeps only the publicId,
 * this fetches the rest. `enabled: false` when no publicId so the
 * query doesn't fire on routes without an active member filter.
 */
export function memberForLoanByPublicIdQueryOptions(publicId: string | null) {
  return {
    queryKey: publicId
      ? memberForLoanByPublicIdQueryKey(publicId)
      : (["gear", "loans", "member", "(none)"] as const),
    queryFn: publicId
      ? () => getMemberForLoanFn({ data: { publicId } })
      : async () => null,
    enabled: publicId !== null,
  } as const;
}

export function gearCodeSearchQueryOptions(q: string) {
  const trimmed = q.trim();
  return {
    queryKey: gearCodeSearchQueryKey(trimmed),
    queryFn: () => searchItemsByCodeFn({ data: { q: trimmed } }),
    enabled: trimmed.length > 0,
  } as const;
}

/**
 * Exact-match lookup for a barcode scan result. Not memoized as a
 * `useQuery` factory — the scanner's `onResult` callsite invokes
 * `getItemByCodeFn` imperatively via the underlying mutation/manual
 * fetch and feeds the row into local state. Exposed here as a small
 * helper so callsites don't reach into the server fn module directly.
 */
export function fetchGearByCode(code: string) {
  return getItemByCodeFn({ data: { code } });
}
