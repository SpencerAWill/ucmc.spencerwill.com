import { createFileRoute } from "@tanstack/react-router";

import { requirePermission } from "#/features/auth/guards";
import { CreateRoleDialog } from "#/features/members/components/create-role-dialog";
import { RolesListEditor } from "#/features/members/components/roles-list-editor";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * Root-level access-control panel, a sibling of `/settings` rather than a
 * child of `/members`. Roles govern every feature's permissions, not just
 * membership, so the surface sits at the root and appears in the sidebar's
 * utility group next to Settings.
 *
 * Named `/access` rather than `/roles` or `/permissions` because it is the
 * umbrella for both nouns — today role editing and permission grants,
 * later anything else deciding who can do what — so widening its scope
 * won't force a rename. The permission gating it stays `roles:manage`,
 * which names the domain object actually being edited.
 *
 * `/members` is not auth-gated, so moving out from under it changes
 * nothing about guard ordering: the page flag is still checked first
 * (uniform 404 when off, regardless of permission), then the permission.
 */
export const Route = createFileRoute("/access")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "access");
    await requirePermission(context.queryClient, "roles:manage");
  },
  component: AccessPage,
});

function AccessPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      {/* Title and primary action share one row, matching /gear and the
       * other root-level admin surfaces. The subtitle carries the
       * how-to that used to sit in a second row above the list. */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Roles &amp; permissions</h1>
          <p className="text-sm text-muted-foreground">
            Drag to reorder. Click the pencil to edit a role&rsquo;s members,
            permissions, or details.
          </p>
        </div>
        <CreateRoleDialog />
      </header>
      <RolesListEditor />
    </div>
  );
}
