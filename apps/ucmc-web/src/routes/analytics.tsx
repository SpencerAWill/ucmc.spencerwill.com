import { Outlet, createFileRoute } from "@tanstack/react-router";

import { ANALYTICS_VIEW_PERMISSION } from "#/config/analytics-pages";
import { requirePermission } from "#/features/auth/guards";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

/**
 * Layout route for `/analytics/*`. One `analytics:view` check opens the
 * whole area; each leaf additionally gates on the permission for the
 * data it shows (`requireAnyPermissionOrNotFound` over the registry's
 * `dataPermissions`), which is why this guard is the permissive half of
 * the pair rather than the only one.
 *
 * `requireEnabledPages` runs first so a switched-off page 404s
 * uniformly instead of redirecting an unauthorized visitor to sign-in
 * before it gets the chance — see `page-guards.ts` for why the walk
 * belongs in the shallow parent and the leaves name their own flag.
 */
export const Route = createFileRoute("/analytics")({
  beforeLoad: async ({ context, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
    await requirePermission(context.queryClient, ANALYTICS_VIEW_PERMISSION);
  },
  component: AnalyticsLayout,
});

function AnalyticsLayout() {
  return <Outlet />;
}
