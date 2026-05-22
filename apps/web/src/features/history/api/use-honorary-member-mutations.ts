import { useMutation, useQueryClient } from "@tanstack/react-query";

import { HISTORY_CONTENT_QUERY_KEY } from "#/features/history/api/query-keys";
import {
  createHonoraryMemberFn,
  deleteHonoraryMemberFn,
  updateHonoraryMemberFn,
} from "#/features/history/server/history-fns";
import type {
  CreateHonoraryMemberInput,
  DeleteByIdInput,
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
