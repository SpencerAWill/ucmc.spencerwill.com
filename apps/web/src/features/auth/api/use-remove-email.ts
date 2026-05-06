import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MY_EMAILS_QUERY_KEY } from "#/features/auth/api/query-keys";
import { removeEmailFn } from "#/features/auth/server/email-fns";

export function useRemoveEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (emailId: string) => removeEmailFn({ data: { emailId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: MY_EMAILS_QUERY_KEY });
    },
  });
}
