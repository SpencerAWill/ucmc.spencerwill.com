import { useMutation, useQueryClient } from "@tanstack/react-query";

import { HISTORY_CONTENT_QUERY_KEY } from "#/features/history/api/query-keys";
import {
  createHistoricalOfficerFn,
  deleteHistoricalOfficerFn,
  deleteHistoricalOfficersByYearFn,
  updateHistoricalOfficerFn,
} from "#/features/history/server/history-fns";
import type {
  CreateHistoricalOfficerInput,
  DeleteByIdInput,
  DeleteOfficersByYearInput,
  UpdateHistoricalOfficerInput,
} from "#/features/history/server/history-schemas";

/**
 * Create / update / delete past-officer entries. Each mutation
 * invalidates the bundled /history query so the page re-renders
 * with the new state. Keeping the three hooks in one file because
 * they share the same invalidation contract and the same
 * permission gate at the server layer (`history:manage`).
 */
export function useCreateHistoricalOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateHistoricalOfficerInput) =>
      createHistoricalOfficerFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: HISTORY_CONTENT_QUERY_KEY }),
  });
}

export function useUpdateHistoricalOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateHistoricalOfficerInput) =>
      updateHistoricalOfficerFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: HISTORY_CONTENT_QUERY_KEY }),
  });
}

export function useDeleteHistoricalOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteByIdInput) => deleteHistoricalOfficerFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: HISTORY_CONTENT_QUERY_KEY }),
  });
}

/**
 * Bulk-delete every officer entry for one school year. Returns the
 * deleted-row count + the schoolYear string from the deleted rows
 * (mostly informational; toasts use the count).
 */
export function useDeleteHistoricalOfficersByYear() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteOfficersByYearInput) =>
      deleteHistoricalOfficersByYearFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: HISTORY_CONTENT_QUERY_KEY }),
  });
}
