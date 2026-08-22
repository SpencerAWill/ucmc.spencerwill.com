import { useMutation, useQueryClient } from "@tanstack/react-query";

import { PASSKEY_LIST_QUERY_KEY } from "#/features/auth/api/query-keys";
import { renamePasskeyFn } from "#/features/auth/server/webauthn-fns";

/**
 * Relabel one of the user's registered passkey credentials. Invalidates
 * the list on success so the row re-renders with the stored name — which
 * may differ from what was typed, since the server trims it and turns an
 * all-whitespace name into no name at all.
 *
 * Deliberately not optimistic: a rename is a deliberate, low-frequency
 * edit behind an explicit Save, so there's no interaction cost to pay
 * for, and showing the server's normalized value is more honest than
 * showing the raw input and correcting it a moment later.
 */
export function useRenamePasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { credentialId: string; nickname: string }) =>
      renamePasskeyFn({ data: args }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PASSKEY_LIST_QUERY_KEY });
    },
  });
}
