import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  passkeyAuthenticationOptionsFn,
  passkeyRegistrationOptionsFn,
  verifyPasskeyAuthenticationFn,
  verifyPasskeyRegistrationFn,
} from "#/server/auth/server-fns";

/**
 * Card for enrolling a new passkey on the current user. Visible on
 * Account → Security and used as a one-time prompt after first approved login.
 */
export function PasskeyEnrollCard({ onEnrolled }: { onEnrolled?: () => void }) {
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (label: string) => {
      const options = await passkeyRegistrationOptionsFn();
      const response = await startRegistration({ optionsJSON: options });
      await verifyPasskeyRegistrationFn({
        data: { response, nickname: label || undefined },
      });
    },
    onSuccess: () => {
      setNickname("");
      onEnrolled?.();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div>
        <h3 className="font-medium">Add a passkey</h3>
        <p className="text-muted-foreground text-sm">
          Sign in faster — and without an email round-trip — using your device.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="passkey-nickname">Nickname (optional)</Label>
        <Input
          id="passkey-nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="e.g. Laptop, Phone"
        />
      </div>
      <Button
        onClick={() => {
          setError(null);
          mutation.mutate(nickname.trim());
        }}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? "Waiting for device…" : "Add passkey"}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

/**
 * "Sign in with a passkey" button for the sign-in page. Uses the discoverable-
 * credential flow: no email needed, the browser picks the credential.
 */
export function PasskeySignInButton({
  onAuthenticated,
}: {
  onAuthenticated?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (useBrowserAutofill: boolean) => {
      const { options, ceremonyId } = await passkeyAuthenticationOptionsFn();
      const response = await startAuthentication({
        optionsJSON: options,
        useBrowserAutofill,
      });
      await verifyPasskeyAuthenticationFn({
        data: { response, ceremonyId },
      });
    },
    onSuccess: () => onAuthenticated?.(),
    onError: (err: Error) => {
      // Swallow aborts — they happen when the user dismisses the autofill
      // prompt, navigates away, or clicks the explicit button (which cancels
      // the in-flight conditional request via SimpleWebAuthn's abort service).
      if (err.name === "AbortError" || err.name === "NotAllowedError") return;
      setError(err.message);
    },
  });

  // Start a conditional-mediation ("passkey autofill") request on mount so
  // 1Password / the browser can surface a native passkey prompt without the
  // user clicking anything. The promise sits pending for the page lifetime
  // until the user picks a credential or we abort.
  // Intentionally empty deps — re-running would race against the pending
  // ceremony. Button clicks go through the same mutation.
  useEffect(() => {
    // Wrap in an object so TS/eslint see the value as mutable across the
    // async closure boundary (a plain `let` gets narrowed to the literal
    // `false` inside the closure).
    const state = { cancelled: false };
    void (async () => {
      if (!(await browserSupportsWebAuthnAutofill())) return;
      if (state.cancelled) return;
      mutation.mutate(true);
    })();
    return () => {
      state.cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={mutation.isPending}
        onClick={() => {
          setError(null);
          mutation.mutate(false);
        }}
      >
        {mutation.isPending ? "Waiting for device…" : "Sign in with a passkey"}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
