import { startAuthentication } from "@simplewebauthn/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { SESSION_QUERY_KEY } from "#/features/auth/api/query-keys";
import {
  webauthnAuthenticateBeginFn,
  webauthnAuthenticateFinishFn,
} from "#/features/auth/server/webauthn-fns";

type Input = { useBrowserAutofill: boolean };

type FinishResult = Awaited<ReturnType<typeof webauthnAuthenticateFinishFn>>;

/**
 * Run the full passkey sign-in ceremony: ask the server for options,
 * hand them to the browser, post the response back. On success
 * invalidates the session cache so the navigating consumer can re-read
 * the freshly-opened principal.
 *
 * Used by the explicit "Sign in with a passkey" button
 * (`useBrowserAutofill: false`). The conditional-UI autofill hook on
 * the magic-link form has slightly different semantics — it bails
 * silently on every error and runs under an AbortSignal — so it
 * stays as its own dedicated `usePasskeyAutofill` effect rather than
 * sharing this hook.
 */
export function usePasskeyAuthenticate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      useBrowserAutofill,
    }: Input): Promise<FinishResult> => {
      const begin = await webauthnAuthenticateBeginFn();
      if (!begin.ok) {
        return begin;
      }
      const response = await startAuthentication({
        optionsJSON: begin.options,
        useBrowserAutofill,
      });
      return webauthnAuthenticateFinishFn({ data: { response } });
    },
    onSuccess: async (result) => {
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      }
    },
  });
}
