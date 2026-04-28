import { startAuthentication } from "@simplewebauthn/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import { SESSION_QUERY_KEY } from "#/features/auth/api/use-auth";
import {
  webauthnAuthenticateBeginFn,
  webauthnAuthenticateFinishFn,
} from "#/features/auth/server/webauthn-fns";

/**
 * Explicit "Sign in with a passkey" trigger for the sign-in page. Runs the
 * same begin → browser ceremony → finish flow as the magic-link form's
 * Conditional-UI autofill hook, but with `useBrowserAutofill: false` so the
 * browser shows its full passkey picker on click rather than waiting for an
 * autofill interaction.
 *
 * Conditional UI is still the fast path for users who reflexively type their
 * email; this button is the discoverable fallback (and the deterministic
 * affordance for e2e tests). Hides itself entirely when WebAuthn isn't
 * supported by the browser.
 */
export function SignInWithPasskeyButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSupported, setIsSupported] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Feature detection runs after mount so the SSR pass renders nothing
  // (server has no `window`); avoids a hydration mismatch.
  useEffect(() => {
    setIsSupported(
      typeof window !== "undefined" &&
        typeof window.PublicKeyCredential !== "undefined",
    );
  }, []);

  const mutation = useMutation({
    mutationFn: async (): Promise<void> => {
      setErrorMessage(null);
      const begin = await webauthnAuthenticateBeginFn();
      if (!begin.ok) {
        throw new Error(reasonToMessage(begin.reason));
      }
      const response = await startAuthentication({
        optionsJSON: begin.options,
        // Explicit picker — opposite of the conditional-UI autofill in
        // usePasskeyAutofill.
        useBrowserAutofill: false,
      });
      const finish = await webauthnAuthenticateFinishFn({ data: { response } });
      if (!finish.ok) {
        throw new Error(reasonToMessage(finish.reason));
      }
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      if (!finish.hasProfile) {
        await navigate({ to: "/register/profile" });
        return;
      }
      if (finish.status !== "approved") {
        await navigate({ to: "/register/pending" });
        return;
      }
      await navigate({ to: "/" });
    },
    onError: (e: unknown) => {
      // User cancellation throws a DOMException with name "NotAllowedError";
      // browser/OS quirks throw various others. Show the message we have
      // rather than a generic banner so debugging is easier.
      if (e instanceof Error) {
        setErrorMessage(e.message);
      } else {
        setErrorMessage("Something went wrong.");
      }
    },
  });

  if (!isSupported) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        <KeyRound />
        {mutation.isPending ? "Waiting for device…" : "Sign in with a passkey"}
      </Button>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function reasonToMessage(reason: string): string {
  switch (reason) {
    case "rate_limited":
      return "Too many requests. Wait a minute and try again.";
    case "no_ceremony":
      return "Your sign-in session expired. Please try again.";
    case "verification_failed":
      return "Couldn't verify that credential. Please try again.";
    case "credential_not_found":
      return "That passkey isn't recognized. Try a different sign-in method.";
    default:
      return "Something went wrong. Please try again.";
  }
}
