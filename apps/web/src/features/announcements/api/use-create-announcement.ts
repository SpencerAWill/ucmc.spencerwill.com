import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  ANNOUNCEMENTS_LIST_QUERY_KEY,
  ANNOUNCEMENTS_UNREAD_QUERY_KEY,
} from "#/features/announcements/api/query-keys";
import { createAnnouncementFn } from "#/features/announcements/server/announcements-fns";
import type { AnnouncementInput } from "#/features/announcements/server/limits";

/**
 * Post a new announcement. On success invalidates both the list (so
 * the new entry appears) and the unread-count badge (so other
 * authenticated tabs surface it). Caller wires its own onError /
 * post-success UI; the hook returns the bare mutation so toast
 * messaging can stay context-aware (e.g. "Posted" vs "Saved").
 */
export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AnnouncementInput) => createAnnouncementFn({ data }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ANNOUNCEMENTS_LIST_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: ANNOUNCEMENTS_UNREAD_QUERY_KEY,
        }),
      ]);
    },
  });
}
