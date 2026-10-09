import { createFileRoute } from "@tanstack/react-router";

/**
 * `/calendar` with no event open.
 *
 * Renders nothing: the calendar itself lives in the `/calendar` layout,
 * and this child exists only so `/calendar/$publicId` has a sibling to
 * be absent for. Without it the layout's `<Outlet />` would have no
 * match at the bare path.
 */
export const Route = createFileRoute("/calendar/")({
  component: () => null,
});
