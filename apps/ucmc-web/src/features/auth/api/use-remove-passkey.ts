import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PASSKEY_LIST_QUERY_KEY } from "#/features/auth/api/query-keys";
import { removePasskeyFn } from "#/features/auth/server/webauthn-fns";

/**
 * Delete one of the user's registered passkey credentials. Invalidates
 * the list on success so the row disappears.
 */
export function useRemovePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentialId: string) =>
      removePasskeyFn({ data: { credentialId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PASSKEY_LIST_QUERY_KEY });
    },
  });
}
