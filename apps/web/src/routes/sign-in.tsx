import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { MagicLinkForm } from "#/components/auth/magic-link-form";

const signInSearchSchema = z.object({
  register: z.boolean().optional(),
  redirect: z.string().optional(),
  // Set by /auth/callback when a magic-link token is already consumed,
  // expired, or otherwise invalid — the /sign-in page renders a small
  // explainer without needing a separate error route.
  invalid: z.boolean().optional(),
});

export const Route = createFileRoute("/sign-in")({
  validateSearch: signInSearchSchema,
  component: SignInPage,
});

function SignInPage() {
  const { register, invalid } = Route.useSearch();
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
      <MagicLinkForm defaultMode={mode} />
    </div>
  );
}
