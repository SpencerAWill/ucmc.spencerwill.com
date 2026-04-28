import { useState } from "react";

import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useAddPasskey } from "#/features/auth/api/use-add-passkey";

/**
 * "Add passkey" button. Drives the full browser-side WebAuthn
 * registration ceremony via `useAddPasskey`:
 *   1. Ask the server for options (challenge stashed in KV).
 *   2. Hand them to the browser → OS passkey UI.
 *   3. POST the attestation back; server verifies, inserts the
 *      credential, and rotates the session.
 * On success, the hook invalidates the passkey list + session caches.
 * The component owns local nickname state and the error display.
 */
export function AddPasskeyButton() {
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useAddPasskey();

  const onClick = () => {
    setError(null);
    mutation.mutate(nickname, {
      onSuccess: (result) => {
        // `mutate` resolves whether finish reported ok or not — surface
        // the mapped reason for the latter and clear the field for
        // the former.
        if (!result.ok) {
          setError(reasonToMessage(result.reason));
          return;
        }
        setNickname("");
      },
      onError: (e: unknown) => {
        // startRegistration throws (user cancel, OS dismiss, browser
        // unsupported); the begin/finish branches don't throw, they
        // resolve with `{ ok: false, reason }` and are handled above.
        setError(e instanceof Error ? e.message : "Something went wrong.");
      },
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="passkey-nickname" className="text-sm font-medium">
          Nickname (optional)
        </Label>
        <Input
          id="passkey-nickname"
          type="text"
          placeholder="e.g. iPhone, YubiKey, Work laptop"
          maxLength={60}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          disabled={mutation.isPending}
        />
        <p className="text-xs text-muted-foreground">
          Used only to help you recognize this passkey later in this list.
        </p>
      </div>
      <div>
        <Button type="button" onClick={onClick} disabled={mutation.isPending}>
          {mutation.isPending ? "Waiting for device…" : "Add this device"}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function reasonToMessage(reason: string): string {
  switch (reason) {
    case "rate_limited":
      return "Too many requests. Wait a minute and try again.";
    case "unauthorized":
      return "Sign in before adding a passkey.";
    case "no_ceremony":
      return "Your enrollment session expired. Please try again.";
    case "verification_failed":
      return "Couldn't verify that credential. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
