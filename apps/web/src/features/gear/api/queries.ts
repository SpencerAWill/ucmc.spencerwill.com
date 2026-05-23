/**
 * Query options factories for the gear feature. Each factory returns
 * `{ queryKey, queryFn }` shape so route loaders can call
 * `queryClient.ensureQueryData(...)` and components can call
 * `useQuery(...)` against the same key.
 */
import {
  GEAR_QUERY_KEY,
  GEAR_TAGS_QUERY_KEY,
  GEAR_TYPES_QUERY_KEY,
  LOANS_QUERY_KEY,
  MY_CART_QUERY_KEY,
  MY_LOANS_QUERY_KEY,
  gearCodeSearchQueryKey,
  gearDetailQueryKey,
  gearInspectionsQueryKey,
  gearLabelsQueryKey,
  gearSuggestedCodeQueryKey,
  loanDetailQueryKey,
  memberForLoanByPublicIdQueryKey,
  memberLoanSearchQueryKey,
} from "#/features/gear/api/query-keys";
import {
  getGearByCodeFn,
  getGearDetailFn,
  getLoanDetailFn,
  getMemberForLoanFn,
  getMyCartFn,
  listGearFn,
  listGearInspectionsFn,
  listGearLabelsFn,
  listGearTagsFn,
  listGearTypesFn,
  listLoansFn,
  listMyLoansFn,
  searchGearByCodeFn,
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

export function gearTagsQueryOptions() {
  return {
    queryKey: GEAR_TAGS_QUERY_KEY,
    queryFn: () => listGearTagsFn(),
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
    queryFn: () => searchGearByCodeFn({ data: { q: trimmed } }),
    enabled: trimmed.length > 0,
  } as const;
}

/**
 * Exact-match lookup for a barcode scan result. Not memoized as a
 * `useQuery` factory — the scanner's `onResult` callsite invokes
 * `getGearByCodeFn` imperatively via the underlying mutation/manual
 * fetch and feeds the row into local state. Exposed here as a small
 * helper so callsites don't reach into the server fn module directly.
 */
export function fetchGearByCode(code: string) {
  return getGearByCodeFn({ data: { code } });
}
