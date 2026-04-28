import { Turnstile } from "@marsidev/react-turnstile";
import { startAuthentication } from "@simplewebauthn/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { env } from "#/config/env";
import { SESSION_QUERY_KEY } from "#/lib/auth/use-auth";
import { useAppForm } from "#/lib/form/form";
import { requestMagicLinkFn } from "#/server/auth/server-fns";
import {
  webauthnAuthenticateBeginFn,
  webauthnAuthenticateFinishFn,
} from "#/server/auth/webauthn-fns";

const magicLinkSchema = z.object({
  email: z.email("Enter a valid email address").trim().toLowerCase().max(254),
});

/**
 * Always-enumeration-proof magic-link request form. Success renders the
 * same "check your email" message regardless of whether the email is
 * registered, rate-limited, or newly-seen — the server deliberately
 * returns the same shape in each case.
 *
 * On sign-in, we also kick off a WebAuthn conditional-UI ceremony: the
 * browser silently watches for a passkey pick inline with the email
 * field's autofill menu. If the user selects a passkey, they skip the
 * email step entirely and land signed in.
 */
export function MagicLinkForm({
  defaultMode = "sign-in",
}: {
  defaultMode?: "sign-in" | "register";
}) {
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);
  const turnstileToken = useRef("");
  const turnstileSiteKey = env.VITE_TURNSTILE_SITE_KEY;

  // Passkey autofill runs in the background on sign-in. If it succeeds
  // the whole component navigates away before the magic-link mutation
  // ever fires, so nothing special is needed to "cancel" it.
  usePasskeyAutofill({ enabled: defaultMode === "sign-in" });

  const mutation = useMutation({
    mutationFn: (email: string) =>
      requestMagicLinkFn({
        data: { email, turnstileToken: turnstileToken.current },
      }),
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

      {turnstileSiteKey ? (
        <Turnstile
          siteKey={turnstileSiteKey}
          onSuccess={(token) => {
            turnstileToken.current = token;
          }}
          onExpire={() => {
            turnstileToken.current = "";
          }}
          options={{ theme: "auto", size: "flexible" }}
        />
      ) : null}

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

/**
 * Browser-side conditional-UI ceremony. Runs once on mount if WebAuthn +
 * conditional mediation are supported. Any failure — browser support
 * missing, user cancels, verification rejected — is silently swallowed;
 * the magic-link form stays visible as the fallback.
 */
// TS narrowing treats `signal.aborted` as a literal `false` after each
// early-return, even though it's a live getter that flips when the
// effect's cleanup runs. Disable no-unnecessary-condition for the hook
// body so the between-await abort checks stay readable.
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
function usePasskeyAutofill({ enabled }: { enabled: boolean }): void {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (
      typeof window === "undefined" ||
      typeof window.PublicKeyCredential === "undefined"
    ) {
      return;
    }

    // AbortSignal drives the "is this effect still current?" check —
    // `signal.aborted` is a proper getter so ESLint's
    // no-unnecessary-condition doesn't flag it as dead, unlike a
    // closed-over boolean primitive.
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      try {
        const supported =
          typeof window.PublicKeyCredential.isConditionalMediationAvailable ===
            "function" &&
          (await window.PublicKeyCredential.isConditionalMediationAvailable());
        if (!supported || signal.aborted) {
          return;
        }
        const begin = await webauthnAuthenticateBeginFn();
        if (signal.aborted || !begin.ok) {
          return;
        }
        const response = await startAuthentication({
          optionsJSON: begin.options,
          useBrowserAutofill: true,
        });
        if (signal.aborted) {
          return;
        }
        const finish = await webauthnAuthenticateFinishFn({
          data: { response },
        });
        if (signal.aborted || !finish.ok) {
          return;
        }
        // Mirror the /auth/callback decision table exactly.
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
      } catch {
        // User cancelled, browser timed out, or the ceremony was aborted
        // by a newer call. Silent fallback to magic-link is fine —
        // showing a passkey error on a page the user didn't explicitly
        // interact with would be confusing.
      }
    })();

    return () => {
      controller.abort();
    };
  }, [enabled, navigate, queryClient]);
}
/* eslint-enable @typescript-eslint/no-unnecessary-condition */
