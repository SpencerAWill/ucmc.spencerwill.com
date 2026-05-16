import { Outlet, createFileRoute, useLocation } from "@tanstack/react-router";

import { requireApproved } from "#/features/auth/guards";
import {
  MembersTabsBar,
  getMembersTabSubtitle,
} from "#/features/members/components/members-tabs-bar";

/**
 * Pathless layout for the five status tabs that share the same page
 * chrome: Approved (`/members`), Pending, Unclaimed, Rejected,
 * Deactivated. Lives under `_tabs` so its tab bar doesn't leak into
 * sibling routes like `/members/$publicId`, `/members/roles`, or
 * `/members/waivers`.
 *
 * Gating is intentionally just `requireApproved` here — the approved
 * tab is for any approved member. Each management child route stacks
 * its own `requirePermissionOrNotFound("members:manage")` so direct
 * navigation surfaces a notFound for non-officers; the tab bar itself
 * also hides on a lack of permission.
 */
export const Route = createFileRoute("/members/_tabs")({
  beforeLoad: async ({ context }) => {
    await requireApproved(context.queryClient);
  },
  component: MembersTabsLayout,
});

function MembersTabsLayout() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const subtitle = getMembersTabSubtitle(pathname);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

      <MembersTabsBar />

      <Outlet />
    </div>
  );
}
