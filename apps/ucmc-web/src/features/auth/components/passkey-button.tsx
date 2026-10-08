import { CircleCheck } from "lucide-react";
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
 *
 * Two variants, one ceremony:
 *
 *   - **`full`** (the default) is the `/my/security` affordance: it sits
 *     under `PasskeySection`'s credential list, in its own bordered box,
 *     and offers the nickname field.
 *   - **`compact`** is for the places that offer enrollment *outside*
 *     that list — the `/register/pending` card and the `/my/profile`
 *     nudge. It drops the border (the host card already has one) and the
 *     nickname field, and reports success itself.
 *
 * The nickname field going away in `compact` is the point, not a
 * casualty of the smaller box. A label only starts mattering once
 * there's a second credential to tell apart, and both compact hosts are
 * surfaces a member sees when they have *zero* — the same reasoning that
 * put the inline rename on `PasskeySection` in the first place. Nothing
 * is lost: the passkey lands as "Unnamed passkey" and can be renamed
 * from Security whenever a second device makes that worth doing.
 *
 * The success confirmation is likewise compact-only. In the full variant
 * the list below re-renders with the new credential, which is a better
 * confirmation than any sentence; the compact hosts have no list, so
 * without this the ceremony would complete to no visible change at all.
 */
export function AddPasskeyButton({
  variant = "full",
}: {
  variant?: "full" | "compact";
} = {}) {
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const mutation = useAddPasskey();
  const compact = variant === "compact";

  const onClick = () => {
    setError(null);
    mutation.mutate(compact ? "" : nickname, {
      onSuccess: (result) => {
        // `mutate` resolves whether finish reported ok or not — surface
        // the mapped reason for the latter and clear the field for
        // the former.
        if (!result.ok) {
          setError(reasonToMessage(result.reason));
          return;
        }
        setNickname("");
        setAdded(true);
      },
      onError: (e: unknown) => {
        // startRegistration throws (user cancel, OS dismiss, browser
        // unsupported); the begin/finish branches don't throw, they
        // resolve with `{ ok: false, reason }` and are handled above.
        setError(e instanceof Error ? e.message : "Something went wrong.");
      },
    });
  };

  const errorAlert = error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  if (compact) {
    return (
      <div className="flex flex-col gap-3">
        {added ? (
          // `role="status"` because the ceremony finishes in OS UI that
          // has already taken focus away — a sighted member watches the
          // sheet dismiss, but nothing announces the result otherwise.
          <p
            role="status"
            className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400"
          >
            <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
            Passkey added on this device.
          </p>
        ) : (
          <div>
            <Button
              type="button"
              onClick={onClick}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Waiting for device…" : "Add a passkey"}
            </Button>
          </div>
        )}
        {errorAlert}
      </div>
    );
  }

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
      {errorAlert}
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
