import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";

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
  { to: "/my/account", label: "Profile" },
  { to: "/my/account/details", label: "Details" },
  { to: "/my/account/waiver", label: "Waiver" },
  { to: "/my/account/security", label: "Sign-in" },
  { to: "/my/account/preferences", label: "Preferences" },
] as const;

function AccountLayout() {
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
          {TABS.map((tab) => (
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
