import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout route for `/members/*`. Not auth-gated — child routes gate
 * themselves. The pathless `_tabs` group hosts the five status views
 * (Approved / Pending / Unclaimed / Rejected / Deactivated) with a
 * shared tab bar; `members.$publicId`, `members.roles`, and
 * `members.waivers` are direct siblings that opt out of that chrome.
 */
export const Route = createFileRoute("/members")({
  component: MembersLayout,
});

function MembersLayout() {
  return <Outlet />;
}
