import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { useAppForm } from "#/lib/form/form";
import { requestMagicLinkFn } from "#/server/auth/server-fns";

const magicLinkSchema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase().max(254),
});

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
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (email: string) => requestMagicLinkFn({ data: { email } }),
    onSuccess: (_data, vars) => setSubmittedTo(vars),
  });

  const form = useAppForm({
    defaultValues: { email: "" },
    validators: {
      onMount: magicLinkSchema,
      onChange: magicLinkSchema,
      onBlur: magicLinkSchema,
      onSubmit: magicLinkSchema,
    },
    onSubmit: ({ value }) => {
      mutation.mutate(value.email);
    },
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
            form.reset();
          }}
        >
          Use a different email
        </button>
      </div>
    );
  }

  const buttonLabel =
    defaultMode === "register" ? "Send registration link" : "Send sign-in link";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="email">
        {(field) => (
          <field.TextField
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete={
              defaultMode === "sign-in" ? "username webauthn" : "email"
            }
          />
        )}
      </form.AppField>

      {mutation.isError ? (
        <p className="text-sm text-destructive">
          Couldn&rsquo;t send the email. Please try again.
        </p>
      ) : null}

      <form.AppForm>
        <form.SubscribeButton label={buttonLabel} />
      </form.AppForm>
    </form>
  );
}
