/**
 * TanStack Query keys for the gear feature. Centralized so query
 * options and mutation hooks always invalidate the same prefix. The
 * list / detail / types / tags / suggested-code surfaces each get their
 * own key so unrelated mutations don't blow the whole gear cache away.
 */

export const GEAR_QUERY_KEY = ["gear", "list"] as const;

export const gearDetailQueryKey = (publicId: string) =>
  ["gear", "detail", publicId] as const;

export const GEAR_TYPES_QUERY_KEY = ["gear", "types"] as const;

export const GEAR_TAGS_QUERY_KEY = ["gear", "tags"] as const;

export const gearSuggestedCodeQueryKey = (typePublicId: string) =>
  ["gear", "suggestedCode", typePublicId] as const;

export const gearInspectionsQueryKey = (gearPublicId: string) =>
  ["gear", "inspections", gearPublicId] as const;

export const gearLabelsQueryKey = (publicIds: readonly string[]) =>
  ["gear", "labels", [...publicIds].sort().join(",")] as const;
