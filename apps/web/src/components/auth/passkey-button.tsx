import { useMutation, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { SESSION_QUERY_KEY } from "#/lib/auth/use-auth";
import {
  webauthnRegisterBeginFn,
  webauthnRegisterFinishFn,
} from "#/server/auth/webauthn-fns";

/**
 * "Add passkey" button. Runs the full browser-side WebAuthn registration
 * ceremony on click:
 *   1. Ask the server for options (challenge is stashed in KV server-side).
 *   2. Hand them to @simplewebauthn/browser so the browser prompts the
 *      OS passkey UI.
 *   3. POST the OS's response back to the server for verification. The
 *      server inserts the credential and rotates the session.
 * On success, invalidates the passkey list query so the caller's UI
 * re-renders with the new credential.
 */
export function AddPasskeyButton({
  listQueryKey,
}: {
  /** Query key for the passkey list so we can invalidate on success. */
  listQueryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (inputNickname: string): Promise<void> => {
      setError(null);
      const begin = await webauthnRegisterBeginFn();
      if (!begin.ok) {
        throw new Error(reasonToMessage(begin.reason));
      }
      // Browser handles the rest: OS prompt, credential creation,
      // returning the attestation. Can throw if the user cancels.
      const response = await startRegistration({ optionsJSON: begin.options });
      const finish = await webauthnRegisterFinishFn({
        data: {
          response,
          nickname: inputNickname.trim() || undefined,
        },
      });
      if (!finish.ok) {
        throw new Error(reasonToMessage(finish.reason));
      }
    },
    onSuccess: async () => {
      setNickname("");
      await queryClient.invalidateQueries({ queryKey: listQueryKey });
      // Session was rotated server-side — refetch the principal too.
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
    onError: (e: unknown) => {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Something went wrong.");
      }
    },
  });

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
        <Button
          type="button"
          onClick={() => mutation.mutate(nickname)}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Waiting for device…" : "Add this device"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
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
