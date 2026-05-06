import { createFileRoute, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";
import { requireApproved } from "#/features/auth/guards";

/**
 * Parent layout for the entire `/my/*` personal namespace. Runs the
 * approved-only guard once so children (`my.account.*`, future
 * `my.dashboard`, `my.gear`, `my.trips`) inherit it. Uses
 * `location.pathname` as the redirectFrom so an anonymous user
 * deep-linking into `/my/account/security` lands back there after
 * sign-in instead of bouncing to a generic `/my`.
 */
export const Route = createFileRoute("/my")({
  beforeLoad: async ({ context, location }) => {
    await requireApproved(context.queryClient, location.pathname);
  },
  component: () => <Outlet />,
  errorComponent: RouteErrorFallback,
});
