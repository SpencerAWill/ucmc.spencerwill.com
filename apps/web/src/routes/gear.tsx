import { Outlet, createFileRoute } from "@tanstack/react-router";

import { requirePermission } from "#/features/auth/guards";

/**
 * Layout route for `/gear/*`. Guards on `gear:read` so the entire
 * subtree (browse, detail, types) is gated by a single check; child
 * routes still need `gear:manage` for write-side actions and gate
 * those affordances client-side via `useAuth().hasPermission(...)`.
 */
export const Route = createFileRoute("/gear")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "gear:read");
  },
  component: GearLayout,
});

function GearLayout() {
  return <Outlet />;
}
