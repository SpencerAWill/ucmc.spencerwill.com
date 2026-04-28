import { useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { usePasskeyAuthenticate } from "#/features/auth/api/use-passkey-authenticate";

/**
 * Explicit "Sign in with a passkey" trigger for the sign-in page. Runs
 * the same begin → browser ceremony → finish flow as the magic-link
 * form's Conditional-UI autofill hook, but with `useBrowserAutofill:
 * false` so the browser shows its full passkey picker on click rather
 * than waiting for an autofill interaction.
 *
 * Conditional UI is still the fast path for users who reflexively type
 * their email; this button is the discoverable fallback (and the
 * deterministic affordance for e2e tests). Hides itself entirely when
 * WebAuthn isn't supported by the browser.
 */
export function SignInWithPasskeyButton() {
  const navigate = useNavigate();
  const mutation = usePasskeyAuthenticate();
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
        variant="outline"
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
