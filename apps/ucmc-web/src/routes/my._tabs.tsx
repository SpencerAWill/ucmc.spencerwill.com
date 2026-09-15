import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";
import { AccountTabsBar } from "#/components/layouts/account-tabs-bar";
import { profileQueryOptions } from "#/features/auth/api/queries";

/**
 * Pathless layout for the personal-account tabs: a greeting header, a
 * horizontal tab bar over the sub-routes (Profile / Details / Contacts /
 * Waiver / Security / Preferences) and an `<Outlet />` that renders the
 * active child. Each tab is a real URL (not state), so direct
 * navigation, shareable links, and the browser back button all work.
 *
 * It lives under `_tabs` — rather than a path segment like the old
 * `/my/account` — so the greeting and tab bar don't leak into the other
 * `/my/*` routes. `/my/gear`, `/my/gear/cart`, and the planned
 * `/my/dashboard` + `/my/trips` are direct siblings that opt out of this
 * chrome, which is the whole reason the account URLs lost their
 * `/account` segment: the tab group is now defined by the layout file,
 * not by the URL.
 *
 * The approved-only guard is hoisted to the parent `/my` route, so
 * pending/rejected users get shunted before they reach this layout and
 * anonymous users are redirected to /sign-in with their full intended
 * `/my/...` path preserved as the post-auth redirect. Page kill switches
 * are likewise enforced by `/my`'s `requireEnabledPages(matches)` walk
 * plus each leaf's own `staticData.pageFlag`.
 */
export const Route = createFileRoute("/my/_tabs")({
  component: AccountTabsLayout,
  errorComponent: RouteErrorFallback,
});

function AccountTabsLayout() {
  // Greeting name comes from the profile, not the principal — the
  // principal deliberately carries only identity + RBAC, no display
  // name. `profileQueryOptions` resolves to `{ profile,
  // emergencyContacts }`, so the row itself is one level in. Falls back
  // to a nameless greeting rather than showing an email address or an
  // empty "Hi !" while the query is in flight or if the member left
  // preferred name blank.
  const { data } = useQuery(profileQueryOptions());
  const preferredName = data?.profile?.preferredName.trim();

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">
        {preferredName ? `Hi ${preferredName}!` : "Hi there!"}
      </h1>
      <AccountTabsBar />
      <Outlet />
    </div>
  );
}
