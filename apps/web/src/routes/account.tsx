import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { requireApproved } from "#/lib/auth/guards";

export const Route = createFileRoute("/account")({
  beforeLoad: async ({ context }) => {
    await requireApproved(context.queryClient, "/account");
  },
  component: AccountLayout,
});

const TABS = [
  { to: "/account", label: "Profile" },
  { to: "/account/security", label: "Security" },
  { to: "/account/preferences", label: "Preferences" },
] as const;

function AccountLayout() {
  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">Account</h1>
      <nav className="border-border mb-6 flex gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            activeOptions={{ exact: tab.to === "/account" }}
            className="text-muted-foreground hover:text-foreground border-b-2 border-transparent px-3 py-2 text-sm"
            activeProps={{
              className:
                "border-primary text-foreground border-b-2 px-3 py-2 text-sm",
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
