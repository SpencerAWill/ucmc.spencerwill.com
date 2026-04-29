import { createFileRoute } from "@tanstack/react-router";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { requirePermission } from "#/features/auth/guards";
import { PermissionMatrixEditor } from "#/features/members/components/permission-matrix-editor";
import { RolesListEditor } from "#/features/members/components/roles-list-editor";

export const Route = createFileRoute("/members/roles")({
  beforeLoad: async ({ context }) => {
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

      <Tabs defaultValue="roles">
        <TabsList variant="line">
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
        </TabsList>
        <TabsContent value="roles" className="pt-2">
          <RolesListEditor />
        </TabsContent>
        <TabsContent value="permissions" className="pt-2">
          <PermissionMatrixEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
