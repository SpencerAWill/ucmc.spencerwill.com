import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ANNOUNCEMENTS_UNREAD_QUERY_KEY } from "#/features/announcements/api/query-keys";
import { markAnnouncementsReadFn } from "#/features/announcements/server/announcements-fns";

/**
 * Mark all currently-visible announcements as read for the calling
 * user. Auto-fired when the announcements list page mounts (and
 * whenever the rendered list changes), so the unread badge clears as
 * soon as someone is actively looking at the page. Errors are
 * non-fatal on purpose — viewing still works if the marker write fails.
 */
export function useMarkAnnouncementsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAnnouncementsReadFn(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ANNOUNCEMENTS_UNREAD_QUERY_KEY,
      });
    },
  });
}
