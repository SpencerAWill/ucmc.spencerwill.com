import { createFileRoute } from "@tanstack/react-router";

import { requirePermission } from "#/features/auth/guards";
import { RolesListEditor } from "#/features/members/components/roles-list-editor";
import { requirePageFlag } from "#/features/settings/api/page-guards";

export const Route = createFileRoute("/members/roles")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "members_roles");
    await requirePermission(context.queryClient, "roles:manage");
  },
  component: RolesPage,
});

function RolesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Roles &amp; permissions
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage roles, their order, and which permissions each role grants.
        </p>
      </div>
      <RolesListEditor />
    </div>
  );
}
