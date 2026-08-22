import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";
import type { PageFlagKey } from "#/server/settings/settings-registry";

/**
 * Account hub layout: a page-level container with a horizontal tab bar
 * over the sub-routes (Profile / Details / Waiver / Sign-in /
 * Preferences) and an `<Outlet />` that renders the active child. Each
 * tab is a real URL (not state), so direct navigation, shareable links,
 * and the browser back button all work correctly. The Sign-in tab
 * still routes to `/my/account/security` — only the label was renamed,
 * so existing bookmarks and the passkey E2E keep working.
 *
 * The approved-only guard is hoisted to the parent `/my` route, so
 * pending/rejected users get shunted before they reach this layout
 * and anonymous users are redirected to /sign-in with their full
 * intended `/my/...` path preserved as the post-auth redirect.
 */
export const Route = createFileRoute("/my/account")({
  component: AccountLayout,
  errorComponent: RouteErrorFallback,
});

const TABS = [
  { to: "/my/account", label: "Profile", flag: "my_account" },
  { to: "/my/account/details", label: "Details", flag: "my_account_details" },
  { to: "/my/account/waiver", label: "Waiver", flag: "my_account_waiver" },
  { to: "/my/account/security", label: "Sign-in", flag: "my_account_security" },
  {
    to: "/my/account/preferences",
    label: "Preferences",
    flag: "my_account_preferences",
  },
] as const satisfies ReadonlyArray<{
  to: string;
  label: string;
  flag: PageFlagKey;
}>;

function AccountLayout() {
  // Per-page kill switches: hide any tab whose page has been switched off
  // from /settings. Each route also 404s independently.
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const pages = flags.pages;
  const visibleTabs = TABS.filter((tab) => pages[tab.flag]);
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Account</h1>
      {/*
       * The tab bar is allowed to overflow horizontally on narrow viewports
       * rather than wrapping — five labels at body-text size will line-wrap
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
              // Only the Profile tab uses exact matching — sibling tabs
              // should stay active when their own tab is selected, and
              // /my/account should NOT stay active when one of the
              // siblings is.
              activeOptions={{ exact: tab.to === "/my/account" }}
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
