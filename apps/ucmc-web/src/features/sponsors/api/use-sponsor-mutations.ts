import { useMutation, useQueryClient } from "@tanstack/react-query";

import { SPONSORS_CONTENT_QUERY_KEY } from "#/features/sponsors/api/query-keys";
import {
  createSponsorFn,
  deleteSponsorFn,
  reorderSponsorsFn,
  updateSponsorFn,
} from "#/features/sponsors/server/sponsor-fns";
import type {
  CreateSponsorInput,
  DeleteSponsorInput,
  ReorderSponsorsInput,
  UpdateSponsorInput,
} from "#/features/sponsors/server/sponsor-schemas";

/**
 * Create / update / delete / reorder sponsors. Every one invalidates the
 * single page bundle — the grid is one cache entry.
 */
export function useCreateSponsor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSponsorInput) => createSponsorFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SPONSORS_CONTENT_QUERY_KEY }),
  });
}

export function useUpdateSponsor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateSponsorInput) => updateSponsorFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SPONSORS_CONTENT_QUERY_KEY }),
  });
}

export function useDeleteSponsor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteSponsorInput) => deleteSponsorFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SPONSORS_CONTENT_QUERY_KEY }),
  });
}

export function useReorderSponsors() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ReorderSponsorsInput) => reorderSponsorsFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SPONSORS_CONTENT_QUERY_KEY }),
  });
}
