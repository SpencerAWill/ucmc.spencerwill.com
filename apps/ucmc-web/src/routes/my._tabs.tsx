import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";
import { profileQueryOptions } from "#/features/auth/api/queries";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";
import type { PageFlagKey } from "#/server/settings/settings-registry";

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

const TABS = [
  { to: "/my/profile", label: "Profile", flag: "my_profile" },
  { to: "/my/details", label: "Details", flag: "my_details" },
  { to: "/my/contacts", label: "Contacts", flag: "my_contacts" },
  { to: "/my/waiver", label: "Waiver", flag: "my_waiver" },
  { to: "/my/security", label: "Security", flag: "my_security" },
  { to: "/my/preferences", label: "Preferences", flag: "my_preferences" },
] as const satisfies ReadonlyArray<{
  to: string;
  label: string;
  flag: PageFlagKey;
}>;

function AccountTabsLayout() {
  // Per-page kill switches: hide any tab whose page has been switched off
  // from /settings. Each route also 404s independently.
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const pages = flags.pages;
  const visibleTabs = TABS.filter((tab) => pages[tab.flag]);

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
      {/*
       * The tab bar is allowed to overflow horizontally on narrow viewports
       * rather than wrapping — six labels at body-text size will line-wrap
       * on a phone, which looked broken. `border-b` lives on the container
       * so the underline runs the full visual width even after the row
       * scrolls. Per-link `whitespace-nowrap` keeps individual labels intact.
       */}
      <div className="mb-6 -mx-6 border-b border-border">
        <nav className="flex gap-1 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleTabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
              activeProps={{
                className:
                  "-mb-px shrink-0 border-b-2 border-primary px-3 py-2 text-sm whitespace-nowrap text-foreground",
              }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
