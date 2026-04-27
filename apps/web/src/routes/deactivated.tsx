import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "#/lib/auth/guards";

/**
 * Shown to signed-in users whose account has been deactivated by an
 * administrator. Requires a session (requireAuth) but NOT approval.
 *
 * Note: loadCurrentPrincipal already cleans up sessions for deactivated
 * users, so this page is mainly reached via the guard redirect during the
 * same request that discovered the status. On subsequent visits the user
 * won't have a session and will land on /sign-in instead.
 */
export const Route = createFileRoute("/deactivated")({
  beforeLoad: async ({ context }) => {
    await requireAuth(context.queryClient);
  },
  component: DeactivatedPage,
});

function DeactivatedPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Account deactivated</h1>
        <p className="text-sm text-muted-foreground">
          Your account has been deactivated by a club administrator. If you
          believe this is an error, please contact a club officer to have your
          account reactivated.
        </p>
      </header>
    </div>
  );
}
