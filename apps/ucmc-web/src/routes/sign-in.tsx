import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { PageContainer } from "#/components/layouts/page-container";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { MagicLinkForm } from "#/features/auth/components/magic-link-form";
import {
  SignInWithPasskeyButton,
  useWebAuthnSupported,
} from "#/features/auth/components/sign-in-with-passkey-button";
import { safeReturnPath } from "#/lib/safe-return-path";

// URL search params arrive as strings; coerce so `?invalid=true` parses
// correctly whether the user landed here via a TanStack Router redirect
// (actual boolean) or a hand-typed URL (string).
//
// There is no `register` param: the server decides register vs. log in
// from whether the email already exists, so one page serves both. Old
// `?register=true` links still land here — the object schema strips
// unknown keys rather than rejecting them.
const signInSearchSchema = z.object({
  redirect: z.string().optional(),
  // Set by /auth/callback when a magic-link token is already consumed,
  // expired, or otherwise invalid — the /sign-in page renders a small
  // explainer without needing a separate error route.
  invalid: z.coerce.boolean().optional(),
  // Set by /auth/callback when the auth rate limiter tripped during
  // token consumption — distinct from "invalid" so the user knows to
  // wait rather than re-request.
  rate_limited: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/sign-in")({
  validateSearch: signInSearchSchema,
  component: SignInPage,
});

function SignInPage() {
  const { invalid, rate_limited, redirect } = Route.useSearch();
  // Only honor root-relative paths — anything else (external URL,
  // protocol-relative, control characters) is dropped to prevent
  // open-redirect via crafted /sign-in?redirect=... links.
  const safeRedirect = safeReturnPath(redirect) ?? undefined;
  const passkeySupported = useWebAuthnSupported();

  return (
    <PageContainer width="focused" className="flex flex-col gap-6">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Sign in to UCMC</h1>
        {passkeySupported ? (
          <p className="text-sm text-muted-foreground">
            Use your passkey to sign in instantly.
          </p>
        ) : null}
      </header>
      {invalid ? (
        <Alert variant="destructive">
          <AlertDescription>
            That link was invalid, expired, or already used. Request a new one
            below.
          </AlertDescription>
        </Alert>
      ) : null}
      {rate_limited ? (
        <Alert variant="warning">
          <AlertDescription>
            Too many requests. Wait a minute and try again.
          </AlertDescription>
        </Alert>
      ) : null}
      {/* Passkey first: it skips the email round-trip. Without WebAuthn
          the button hides itself, and the divider goes with it rather than
          leading the page with an "or" to nothing. A new visitor simply has
          no passkey. */}
      {passkeySupported ? (
        <>
          <SignInWithPasskeyButton redirectTo={safeRedirect} />
          <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}
      {/* Always mounted, never behind a disclosure: its email field carries
          the passkey-autofill ceremony (`autoComplete="username webauthn"`),
          which a collapsed form would never start. */}
      <section className="space-y-4">
        <p className="text-center text-sm text-muted-foreground">
          No passkey yet, or new here? We&rsquo;ll email you a link &mdash; it
          also starts registration.
        </p>
        <MagicLinkForm redirectTo={safeRedirect} />
      </section>
    </PageContainer>
  );
}
