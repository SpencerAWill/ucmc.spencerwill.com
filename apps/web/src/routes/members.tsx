import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout route for `/members/*`. Not auth-gated — will eventually host
 * a public-facing members directory. Individual child routes (like
 * `/members/registrations`) gate themselves with the appropriate
 * permission guard.
 */
export const Route = createFileRoute("/members")({
  component: MembersLayout,
});

function MembersLayout() {
  return <Outlet />;
}
