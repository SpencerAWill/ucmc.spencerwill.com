import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout route for `/feedback/*`. Pass-through Outlet — gating happens
 * inside the pathless `_tabs` group and on each tab's leaf route, so a
 * user with permission to one surface but not the other lands cleanly
 * on the surface they can see (see the redirect logic in
 * `feedback._tabs.index.tsx`).
 */
export const Route = createFileRoute("/feedback")({
  component: FeedbackLayout,
});

function FeedbackLayout() {
  return <Outlet />;
}
