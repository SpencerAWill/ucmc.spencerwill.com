import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { requestMagicLinkFn } from "#/server/auth/server-fns";

/**
 * Always-enumeration-proof magic-link request form. Success renders the
 * same "check your email" message regardless of whether the email is
 * registered, rate-limited, or newly-seen — the server deliberately
 * returns the same shape in each case.
 */
export function MagicLinkForm({
  defaultMode = "sign-in",
}: {
  defaultMode?: "sign-in" | "register";
}) {
  const [email, setEmail] = useState("");
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (e: string) => requestMagicLinkFn({ data: { email: e } }),
    onSuccess: (_data, vars) => setSubmittedTo(vars),
  });

  if (submittedTo) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-foreground">
          Check <strong>{submittedTo}</strong> for a sign-in link. It expires in
          15 minutes.
        </p>
        <button
          type="button"
          className="text-primary underline-offset-4 hover:underline"
          onClick={() => {
            setSubmittedTo(null);
            setEmail("");
          }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = email.trim();
        if (trimmed) {
          mutation.mutate(trimmed);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          // `webauthn` hint is sign-in only; Phase 7 will surface a
          // passkey autofill prompt via conditional mediation.
          autoComplete={
            defaultMode === "sign-in" ? "username webauthn" : "email"
          }
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <Button type="submit" disabled={mutation.isPending} className="w-full">
        {mutation.isPending
          ? "Sending…"
          : defaultMode === "register"
            ? "Send registration link"
            : "Send sign-in link"}
      </Button>
      {mutation.isError ? (
        <p className="text-sm text-destructive">
          Couldn&rsquo;t send the email. Please try again.
        </p>
      ) : null}
    </form>
  );
}
