import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import { SESSION_QUERY_KEY } from "#/features/auth/api/use-auth";
import { consumeMagicLinkFn } from "#/features/auth/server/server-fns";
import type { ConsumeMagicLinkResult } from "#/features/auth/server/server-fns";

const callbackSearchSchema = z.object({
  token: z.string().min(1),
  // Optional post-sign-in destination round-tripped by route guards
  // that redirect anonymous users to /sign-in?redirect=<path>. Only
  // consumed when an approved user lands here — other branches of the
  // decision table have fixed destinations.
  redirect: z.string().optional(),
});

/**
 * Magic-link landing page. Renders a "Continue" button that the user must
 * click to actually consume the token. This defeats enterprise email
 * scanners (Microsoft Safe Links, Proofpoint, Barracuda, etc.) that
 * pre-fetch every link — they GET this page but never click the button,
 * so the single-use token stays unconsumed until the real user arrives.
 *
 * Decision table (driven by current user state, not the link's intent):
 *
 *   no user row yet              → /register/profile   (proof cookie set)
 *   user w/o profile             → /register/profile   (session opened)
 *   user + profile, not approved → /register/pending    (session opened)
 *   user + profile, approved     → search.redirect ?? "/"
 *
 * Failure paths send the user back to /sign-in with a hint the UI can
 * read so it renders a contextual banner.
 */
export const Route = createFileRoute("/auth/callback")({
  validateSearch: callbackSearchSchema,
  component: CallbackPage,
});

function CallbackPage() {
  const { token, redirect: redirectTo } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => consumeMagicLinkFn({ data: { token } }),
    onSuccess: async (result: ConsumeMagicLinkResult) => {
      // Invalidate the cached session BEFORE navigating — the consume
      // call just set a session cookie (or proof cookie), but the
      // queryClient may still hold {principal: null} from the /sign-in
      // page the user was on before clicking the magic link. Without
      // this, the destination route's guard (requireAuth / requireProof)
      // would read the stale cache and redirect back to /sign-in.
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });

      if (!result.ok) {
        await navigate({
          to: "/sign-in",
          search: {
            invalid: result.reason === "invalid" ? true : undefined,
            rate_limited: result.reason === "rate_limited" ? true : undefined,
          },
        });
        return;
      }

      if (result.mode === "session") {
        if (!result.hasProfile) {
          await navigate({ to: "/register/profile" });
          return;
        }
        if (result.status !== "approved") {
          await navigate({ to: "/register/pending" });
          return;
        }
        const target =
          redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
        await navigate({ to: target });
        return;
      }

      // mode === "proof" — first-time registrant.
      await navigate({ to: "/register/profile" });
    },
    onError: async () => {
      await navigate({ to: "/sign-in", search: { invalid: true } });
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-6 py-16">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">Verify your email</h1>
        <p className="text-sm text-muted-foreground">
          Click the button below to continue. This extra step keeps your link
          safe from automated email scanners.
        </p>
      </header>
      <Button
        size="lg"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? "Verifying…" : "Continue to UCMC"}
      </Button>
      {mutation.isError ? (
        <p className="text-sm text-destructive">
          Something went wrong. Please request a new link.
        </p>
      ) : null}
    </div>
  );
}
