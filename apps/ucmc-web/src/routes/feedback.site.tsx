import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Pass-through layout for `/feedback/site/*`. It exists so the site surface
 * (and the triage page under it) share one `pages.feedback_site` kill switch.
 */
export const Route = createFileRoute("/feedback/site")({
  staticData: { pageFlag: "feedback_site" },
  component: () => <Outlet />,
});
