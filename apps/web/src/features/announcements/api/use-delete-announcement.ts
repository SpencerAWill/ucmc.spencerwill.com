import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ANNOUNCEMENTS_LIST_QUERY_KEY } from "#/features/announcements/api/query-keys";
import { deleteAnnouncementFn } from "#/features/announcements/server/announcements-fns";

export function useDeleteAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAnnouncementFn({ data: { id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ANNOUNCEMENTS_LIST_QUERY_KEY,
      });
    },
  });
}
