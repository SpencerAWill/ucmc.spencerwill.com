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
  gearDetailQueryKey,
  gearSuggestedCodeQueryKey,
} from "#/features/gear/api/query-keys";
import {
  getGearDetailFn,
  listGearFn,
  listGearTagsFn,
  listGearTypesFn,
  suggestCodeForTypeFn,
} from "#/features/gear/server/gear-fns";
import type { ListGearActionInput } from "#/features/gear/server/gear-fns";

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
