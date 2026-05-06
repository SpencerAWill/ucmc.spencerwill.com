import { createFileRoute, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";
import { requireApproved } from "#/features/auth/guards";

/**
 * Parent layout for the entire `/my/*` personal namespace. Runs the
 * approved-only guard once so children (`my.account.*`, future
 * `my.dashboard`, `my.gear`, `my.trips`) inherit it. Uses
 * `location.href` (path + search + hash, no origin) as the redirectFrom
 * so an anonymous user deep-linking into something like
 * `/my/account/security?foo=1#bar` lands back at the exact same URL
 * after sign-in, not just on the bare pathname.
 */
export const Route = createFileRoute("/my")({
  beforeLoad: async ({ context, location }) => {
    await requireApproved(context.queryClient, location.href);
  },
  component: () => <Outlet />,
  errorComponent: RouteErrorFallback,
});
