import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { requestMagicLinkFn } from "#/server/auth/server-fns";

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
        if (email.trim()) mutation.mutate(email.trim());
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          // `webauthn` token lets password managers / browsers surface a
          // passkey autofill prompt when conditional mediation is active
          // (see PasskeySignInButton). Register mode has no passkeys yet,
          // so the hint is sign-in only.
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
      {mutation.isError && (
        <p className="text-destructive text-sm">
          Couldn’t send the email. Please try again.
        </p>
      )}
    </form>
  );
}
