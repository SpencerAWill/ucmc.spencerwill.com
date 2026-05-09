import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "#/features/auth/guards";

/**
 * Shown to signed-in users whose account has been banned by a club
 * officer. Requires a session (requireAuth) but NOT approval.
 *
 * Reachability mirrors `/deactivated`: `loadCurrentPrincipal` clears the
 * session for banned users, so the page is mainly reached during the
 * same request that discovered the status flip (e.g., immediately after
 * sign-in). On subsequent visits the user has no session and lands on
 * /sign-in instead — and a fresh sign-in attempt's magic-link request
 * is silently dropped at the request endpoint, so the only way back
 * here is via an active session that the auth flow allowed to land
 * once before cleanup.
 */
export const Route = createFileRoute("/banned")({
  beforeLoad: async ({ context }) => {
    await requireAuth(context.queryClient);
  },
  component: BannedPage,
});

function BannedPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Account banned</h1>
        <p className="text-sm text-muted-foreground">
          Your account has been banned by a club officer. If you believe this is
          an error, please contact a club officer.
        </p>
      </header>
    </div>
  );
}
