import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";
import { requireApproved } from "#/features/auth/guards";

/**
 * Account hub layout: a page-level container with a horizontal tab bar
 * over the three sub-routes (Profile / Security / Preferences) and an
 * `<Outlet />` that renders the active child. Each tab is a real URL
 * (not state), so direct navigation, shareable links, and the browser
 * back button all work correctly.
 *
 * Gated by `requireApproved` — pending/rejected users can't see the
 * hub; they get shunted to /register/profile (no profile yet) or
 * /register/pending (awaiting exec approval). Anonymous users are
 * redirected to /sign-in with ?redirect=/account.
 */
export const Route = createFileRoute("/account")({
  beforeLoad: async ({ context }) => {
    await requireApproved(context.queryClient, "/account");
  },
  component: AccountLayout,
  errorComponent: RouteErrorFallback,
});

const TABS = [
  { to: "/account", label: "Profile" },
  { to: "/account/details", label: "Details" },
  { to: "/account/security", label: "Security" },
  { to: "/account/preferences", label: "Preferences" },
] as const;

function AccountLayout() {
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Account</h1>
      <nav className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            // Only the Profile tab uses exact matching — /account/security
            // and /account/preferences should stay active when their own
            // tab is selected, and /account should NOT stay active when
            // one of the siblings is.
            activeOptions={{ exact: tab.to === "/account" }}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            activeProps={{
              className:
                "border-b-2 border-primary px-3 py-2 text-sm text-foreground",
            }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
