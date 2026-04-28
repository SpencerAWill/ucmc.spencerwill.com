import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { MagicLinkForm } from "#/components/auth/magic-link-form";
import { SignInWithPasskeyButton } from "#/components/auth/sign-in-with-passkey-button";

// URL search params arrive as strings; coerce so `?register=true` /
// `?invalid=true` parse correctly whether the user landed here via a
// TanStack Router redirect (actual boolean) or a hand-typed URL (string).
const signInSearchSchema = z.object({
  register: z.coerce.boolean().optional(),
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
  const { register, invalid, rate_limited } = Route.useSearch();
  const mode = register ? "register" : "sign-in";
  const heading = register ? "Create your UCMC account" : "Sign in to UCMC";
  const subheading = register
    ? "We’ll email you a link to finish setting up."
    : "We’ll email you a one-time sign-in link.";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-16">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p className="text-sm text-muted-foreground">{subheading}</p>
      </header>
      {invalid ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          That link was invalid, expired, or already used. Request a new one
          below.
        </div>
      ) : null}
      {rate_limited ? (
        <div
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          Too many requests. Wait a minute and try again.
        </div>
      ) : null}
      <MagicLinkForm defaultMode={mode} />
      {/* Passkey users skip the email round-trip. The button hides itself
          when the browser doesn't support WebAuthn, so we don't need a
          conditional gate here. */}
      <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <SignInWithPasskeyButton />
    </div>
  );
}
