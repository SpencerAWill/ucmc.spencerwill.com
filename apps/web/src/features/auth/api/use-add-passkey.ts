import { startRegistration } from "@simplewebauthn/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  PASSKEY_LIST_QUERY_KEY,
  SESSION_QUERY_KEY,
} from "#/features/auth/api/query-keys";
import {
  webauthnRegisterBeginFn,
  webauthnRegisterFinishFn,
} from "#/features/auth/server/webauthn-fns";

/**
 * Run the full passkey registration ceremony: ask the server for
 * options, hand them to the browser's OS passkey UI, post the
 * attestation back for verification + storage. The server rotates the
 * session as part of finish, so we invalidate both the passkey list
 * (new credential appears) and the session query (new principal
 * fingerprint) on success.
 *
 * Errors from begin/finish (rate_limited, unauthorized, no_ceremony,
 * verification_failed) are mapped to readable messages by the calling
 * component via `mutateAsync`; user cancellation surfaces as the raw
 * DOMException.message from `startRegistration`.
 */
export function useAddPasskey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      nickname: string,
    ): Promise<
      | Awaited<ReturnType<typeof webauthnRegisterFinishFn>>
      | { ok: false; reason: string }
    > => {
      const begin = await webauthnRegisterBeginFn();
      if (!begin.ok) {
        return begin;
      }
      const response = await startRegistration({ optionsJSON: begin.options });
      return webauthnRegisterFinishFn({
        data: {
          response,
          nickname: nickname.trim() || undefined,
        },
      });
    },
    onSuccess: async (result) => {
      if (result.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: PASSKEY_LIST_QUERY_KEY }),
          queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
        ]);
      }
    },
  });
}
