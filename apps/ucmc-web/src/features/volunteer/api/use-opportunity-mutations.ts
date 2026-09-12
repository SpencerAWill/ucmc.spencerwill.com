import { useMutation, useQueryClient } from "@tanstack/react-query";

import { VOLUNTEER_CONTENT_QUERY_KEY } from "#/features/volunteer/api/query-keys";
import {
  createOpportunityFn,
  deleteOpportunityFn,
  reorderOpportunitiesFn,
  updateOpportunityFn,
} from "#/features/volunteer/server/volunteer-fns";
import type {
  CreateOpportunityInput,
  DeleteByIdInput,
  ReorderOpportunitiesInput,
  UpdateOpportunityInput,
} from "#/features/volunteer/server/volunteer-schemas";

/**
 * Create / update / delete / reorder the standing volunteer programs.
 * Every one invalidates the single page bundle — the programs, the two
 * event bands and the narrative all live in one cache entry.
 */
export function useCreateOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateOpportunityInput) => createOpportunityFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: VOLUNTEER_CONTENT_QUERY_KEY }),
  });
}

export function useUpdateOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateOpportunityInput) => updateOpportunityFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: VOLUNTEER_CONTENT_QUERY_KEY }),
  });
}

export function useDeleteOpportunity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteByIdInput) => deleteOpportunityFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: VOLUNTEER_CONTENT_QUERY_KEY }),
  });
}

export function useReorderOpportunities() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ReorderOpportunitiesInput) =>
      reorderOpportunitiesFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: VOLUNTEER_CONTENT_QUERY_KEY }),
  });
}
