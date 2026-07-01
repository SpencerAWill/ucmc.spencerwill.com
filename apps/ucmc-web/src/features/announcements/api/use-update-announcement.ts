import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  ANNOUNCEMENTS_LIST_QUERY_KEY,
  ANNOUNCEMENTS_UNREAD_QUERY_KEY,
} from "#/features/announcements/api/query-keys";
import { updateAnnouncementFn } from "#/features/announcements/server/announcements-fns";
import type { AnnouncementInput } from "#/features/announcements/server/limits";

export function useUpdateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } & AnnouncementInput) =>
      updateAnnouncementFn({ data: input }),
    onSuccess: async () => {
      // Edits don't change unread count, but the list ordering /
      // body / title need to refresh.
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
