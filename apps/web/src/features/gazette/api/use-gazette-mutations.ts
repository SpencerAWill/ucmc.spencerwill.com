import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  GAZETTE_LIST_QUERY_KEY,
  gazetteIssueQueryKey,
} from "#/features/gazette/api/query-keys";
import {
  createGazetteIssueFn,
  deleteGazetteIssueFn,
  updateGazetteIssueFn,
} from "#/features/gazette/server/gazette-fns";
import type {
  CreateGazetteIssueInput,
  DeleteGazetteIssueInput,
  UpdateGazetteIssueInput,
} from "#/features/gazette/server/gazette-schemas";

/**
 * Create / update / delete hooks for Goosedown Gazette issues. Each
 * mutation invalidates the bundled list cache; update also
 * invalidates the per-issue detail cache.
 */
export function useCreateGazetteIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateGazetteIssueInput) =>
      createGazetteIssueFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: GAZETTE_LIST_QUERY_KEY }),
  });
}

export function useUpdateGazetteIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateGazetteIssueInput) =>
      updateGazetteIssueFn({ data }),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: GAZETTE_LIST_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: gazetteIssueQueryKey(vars.publicId),
      });
    },
  });
}

export function useDeleteGazetteIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteGazetteIssueInput) =>
      deleteGazetteIssueFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: GAZETTE_LIST_QUERY_KEY }),
  });
}
