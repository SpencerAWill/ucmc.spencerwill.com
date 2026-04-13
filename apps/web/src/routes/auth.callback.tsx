import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { consumeMagicLinkFn } from "#/server/auth/server-fns";
import { SESSION_QUERY_KEY } from "#/lib/auth/use-auth";

export const Route = createFileRoute("/auth/callback")({
  validateSearch: z.object({ token: z.string().optional() }),
  // Consume the token in the loader: runs once per navigation (no strict-mode
  // double-fire), and the redirect happens before any UI renders.
  beforeLoad: async ({ search, context }) => {
    if (!search.token) {
      throw redirect({ to: "/sign-in" });
    }
    const result = await consumeMagicLinkFn({
      data: { token: search.token },
    });
    if (!result.ok || !result.principal) {
      throw redirect({
        to: "/sign-in",
        search: { invalid: true },
      });
    }
    await context.queryClient.invalidateQueries({
      queryKey: SESSION_QUERY_KEY,
    });
    const principal = result.principal;
    if (!principal.hasProfile) {
      throw redirect({ to: "/register/profile" });
    }
    if (principal.status !== "approved") {
      throw redirect({ to: "/register/pending" });
    }
    throw redirect({ to: "/" });
  },
  // Loader always throws above, so this only renders if redirect itself fails.
  component: () => (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 p-12 text-center">
      <p className="text-muted-foreground text-sm">Signing you in…</p>
    </div>
  ),
});
