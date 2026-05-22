import { useMutation, useQueryClient } from "@tanstack/react-query";

import { HISTORY_CONTENT_QUERY_KEY } from "#/features/history/api/query-keys";
import {
  createHonoraryMemberFn,
  deleteHonoraryMemberFn,
  reorderHonoraryMembersFn,
  updateHonoraryMemberFn,
} from "#/features/history/server/history-fns";
import type {
  CreateHonoraryMemberInput,
  DeleteByIdInput,
  ReorderHonoraryMembersInput,
  UpdateHonoraryMemberInput,
} from "#/features/history/server/history-schemas";

/**
 * Create / update / delete honorary-member entries. Same shape as
 * the historical-officer mutation trio; sharing the file keeps the
 * invalidation contract uniform.
 */
export function useCreateHonoraryMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateHonoraryMemberInput) =>
      createHonoraryMemberFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: HISTORY_CONTENT_QUERY_KEY }),
  });
}

export function useUpdateHonoraryMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateHonoraryMemberInput) =>
      updateHonoraryMemberFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: HISTORY_CONTENT_QUERY_KEY }),
  });
}

export function useDeleteHonoraryMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DeleteByIdInput) => deleteHonoraryMemberFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: HISTORY_CONTENT_QUERY_KEY }),
  });
}

/**
 * Bulk reorder honorary members. Caller passes the new display order
 * (lowest sort_order first); server rewrites every row's sort_order
 * to (index + 1) in one batch.
 */
export function useReorderHonoraryMembers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ReorderHonoraryMembersInput) =>
      reorderHonoraryMembersFn({ data }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: HISTORY_CONTENT_QUERY_KEY }),
  });
}
