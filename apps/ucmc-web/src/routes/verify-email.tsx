import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { useConsumeAddEmail } from "#/features/auth/api/use-consume-add-email";

const verifyEmailSearchSchema = z.object({
  token: z.string().min(1),
});

/**
 * Landing page for the verification link emailed by the
 * "Add an email" form on /my/details. Confirms the recipient is
 * signed in to the same account that requested the link
 * (`session.userId === magicLink.targetUserId`), then attaches the
 * email to the account.
 *
 * Same Continue-button pattern as `/auth/callback`: enterprise email
 * scanners will GET this page but never click the button, so the
 * single-use token survives until the real user arrives.
 */
export const Route = createFileRoute("/verify-email")({
  validateSearch: verifyEmailSearchSchema,
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();
  const { principal } = useAuth();
  const navigate = useNavigate();
  const consume = useConsumeAddEmail();
  const [outcome, setOutcome] = useState<
    | { kind: "success"; email: string }
    | { kind: "error"; reason: string }
    | null
  >(null);

  const onVerify = () => {
    consume.mutate(
      { token },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setOutcome({ kind: "success", email: result.email });
          } else {
            setOutcome({ kind: "error", reason: result.reason });
          }
        },
        onError: () => setOutcome({ kind: "error", reason: "invalid" }),
      },
    );
  };

  if (!principal) {
    // Unauthenticated click. Tell the user what to do; do NOT consume
    // the token (the action would refuse anyway).
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-6 py-16">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Sign in to verify</h1>
          <p className="text-sm text-muted-foreground">
            You need to be signed in to the account that requested this link
            before you can verify the new email.
          </p>
        </header>
        <Button asChild size="lg">
          <Link
            to="/sign-in"
            search={{
              redirect: `/verify-email?token=${encodeURIComponent(token)}`,
            }}
          >
            Sign in
          </Link>
        </Button>
      </div>
    );
  }

  if (outcome?.kind === "success") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-6 py-16">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Email verified</h1>
          <p className="text-sm text-muted-foreground">
            <strong>{outcome.email}</strong> is now attached to your account.
            You can sign in with it the next time.
          </p>
        </header>
        <Button size="lg" onClick={() => navigate({ to: "/my/details" })}>
          Back to your account
        </Button>
      </div>
    );
  }

  if (outcome?.kind === "error") {
    const message = errorCopy(outcome.reason);
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-6 py-16">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">
            We couldn&rsquo;t verify that email
          </h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </header>
        <Button asChild size="lg" variant="outline">
          <Link to="/my/details">Back to your account</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-6 py-16">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Verify your email</h1>
        <p className="text-sm text-muted-foreground">
          Click the button below to attach this email to your account. This
          extra step keeps the link safe from automated email scanners.
        </p>
      </header>
      <Button size="lg" disabled={consume.isPending} onClick={onVerify}>
        {consume.isPending ? "Verifying…" : "Verify email"}
      </Button>
    </div>
  );
}

function errorCopy(reason: string): string {
  switch (reason) {
    case "wrong_user":
      return "This link belongs to a different account. Sign in to the account that requested it, then click the link again.";
    case "email_taken":
      return "Another account claimed this email before you could verify it.";
    case "invalid":
      return "The link is expired, already used, or malformed. Request a new one from your account page.";
    case "rate_limited":
      return "Too many attempts. Please wait a minute and try again.";
    case "unauthorized":
      return "You need to be signed in to verify the email.";
    default:
      return "Something went wrong. Please request a new link.";
  }
}
