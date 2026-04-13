import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { MagicLinkForm } from "#/components/auth/magic-link-form";
import { PasskeySignInButton } from "#/components/auth/passkey-enroll-card";
import { SESSION_QUERY_KEY } from "#/lib/auth/use-auth";

const searchSchema = z.object({
  register: z.boolean().optional(),
  redirect: z.string().optional(),
  invalid: z.boolean().optional(),
});

export const Route = createFileRoute("/sign-in")({
  validateSearch: searchSchema,
  component: SignInPage,
});

function SignInPage() {
  const { register, redirect: redirectTo, invalid } = Route.useSearch();
  const queryClient = Route.useRouteContext().queryClient;
  const navigate = Route.useNavigate();
  const isRegister = Boolean(register);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {isRegister ? "Create your account" : "Sign in"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {isRegister
            ? "Enter your email — we’ll send you a link to finish setting up your account."
            : "Use a passkey, or enter your email for a one-time sign-in link."}
        </p>
        {invalid && (
          <p className="text-destructive text-sm" role="alert">
            That sign-in link is invalid or has already been used. Request a new
            one below.
          </p>
        )}
      </header>

      {/* Passkey first — preferred path; instant, no email round-trip. Hidden
          in register mode (a brand-new user has no passkey enrolled yet). */}
      {!isRegister && (
        <>
          <PasskeySignInButton
            onAuthenticated={async () => {
              await queryClient.invalidateQueries({
                queryKey: SESSION_QUERY_KEY,
              });
              await navigate({ to: redirectTo ?? "/" });
            }}
          />
          <div className="relative text-center text-xs uppercase tracking-wide text-muted-foreground">
            <span className="bg-background relative z-10 px-2">or</span>
            <div className="absolute inset-x-0 top-1/2 z-0 h-px bg-border" />
          </div>
        </>
      )}

      <MagicLinkForm defaultMode={isRegister ? "register" : "sign-in"} />

      <p className="text-muted-foreground text-center text-sm">
        {isRegister ? (
          <>
            Already have an account?{" "}
            <Link
              to="/sign-in"
              className="text-primary underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to UCMC?{" "}
            <Link
              to="/sign-in"
              search={{ register: true }}
              className="text-primary underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
