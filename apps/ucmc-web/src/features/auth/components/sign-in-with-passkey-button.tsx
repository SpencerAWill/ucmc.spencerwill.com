import { useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { usePasskeyAuthenticate } from "#/features/auth/api/use-passkey-authenticate";
import { postSignInHref } from "#/features/auth/lib/post-sign-in";

/**
 * Whether this browser can run a WebAuthn ceremony. Assumes it can until
 * the client says otherwise: the passkey button leads the sign-in page,
 * so rendering it only after mount would push the whole page down on
 * every load in the browsers that have WebAuthn (#398). Detection runs
 * after mount (the server has no `window`), so the SSR and hydration
 * passes agree. The sign-in page reads it too, so the "or" divider and
 * the passkey copy go with the button.
 */
export function useWebAuthnSupported(): boolean {
  const [isSupported, setIsSupported] = useState(true);
  useEffect(() => {
    setIsSupported(typeof window.PublicKeyCredential !== "undefined");
  }, []);
  return isSupported;
}

/**
 * Explicit "Sign in with a passkey" trigger for the sign-in page. Runs
 * the same begin → browser ceremony → finish flow as the magic-link
 * form's Conditional-UI autofill hook, but with `useBrowserAutofill:
 * false` so the browser shows its full passkey picker on click rather
 * than waiting for an autofill interaction.
 *
 * The page's primary action (#398). Conditional UI still catches users
 * who reflexively type their email; this button is the discoverable path
 * (and the deterministic affordance for e2e tests). Hides itself once the
 * client finds WebAuthn unsupported.
 */
export function SignInWithPasskeyButton({
  redirectTo,
}: {
  // Optional post-sign-in destination forwarded by the sign-in page when
  // a route guard bounced an anonymous user here. Caller validates
  // leading-"/" before passing.
  redirectTo?: string;
} = {}) {
  const navigate = useNavigate();
  const mutation = usePasskeyAuthenticate();
  const isSupported = useWebAuthnSupported();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onClick = () => {
    setErrorMessage(null);
    mutation.mutate(
      { useBrowserAutofill: false },
      {
        onSuccess: async (finish) => {
          if (!finish.ok) {
            setErrorMessage(reasonToMessage(finish.reason));
            return;
          }
          await navigate({ href: postSignInHref(finish, redirectTo) });
        },
        onError: (e: unknown) => {
          // User cancellation throws a DOMException with name
          // "NotAllowedError"; browser/OS quirks throw various others.
          // Show the message we have rather than a generic banner so
          // debugging is easier.
          setErrorMessage(
            e instanceof Error ? e.message : "Something went wrong.",
          );
        },
      },
    );
  };

  if (!isSupported) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={onClick}
        disabled={mutation.isPending}
      >
        <KeyRound />
        {mutation.isPending ? "Waiting for device…" : "Sign in with a passkey"}
      </Button>
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
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
