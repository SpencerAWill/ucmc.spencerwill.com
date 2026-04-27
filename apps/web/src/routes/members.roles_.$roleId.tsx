import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Shield, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { requirePermission } from "#/lib/auth/guards";
import {
  getRoleFn,
  listPermissionsFn,
  setRolePermissionsFn,
  updateRoleFn,
} from "#/server/auth/rbac-fns";
import type { PermissionSummary, RoleDetail } from "#/server/auth/rbac-fns";

const PERMISSIONS_QUERY_KEY = ["rbac", "permissions"] as const;

function roleQueryKey(roleId: string) {
  return ["rbac", "roles", roleId] as const;
}

export const Route = createFileRoute("/members/roles_/$roleId")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "roles:manage");
  },
  component: RoleDetailPage,
});

function RoleDetailPage() {
  const { roleId } = Route.useParams();

  const { data: role, isLoading: roleLoading } = useQuery({
    queryKey: roleQueryKey(roleId),
    queryFn: () => getRoleFn({ data: { roleId } }),
  });

  const { data: permissions = [] } = useQuery({
    queryKey: PERMISSIONS_QUERY_KEY,
    queryFn: () => listPermissionsFn(),
  });

  if (roleLoading || !role) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-6">
      {/* Back link */}
      <Link
        to="/members/roles"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to roles
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{role.name}</h1>
          <div className="flex items-center gap-2">
            {role.isProtected ? (
              <Badge variant="outline" className="text-xs">
                protected
              </Badge>
            ) : null}
            {role.name === "anonymous" ? (
              <Badge variant="outline" className="text-xs">
                public
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      {/* Description edit */}
      {role.name !== "system_admin" ? (
        <DescriptionEditor roleId={role.id} initial={role.description} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {role.description ??
            "System administrator with full platform control."}
        </p>
      )}

      {/* Permissions */}
      <PermissionGrants role={role} permissions={permissions} />

      {/* Members */}
      {role.name !== "anonymous" ? (
        <div>
          <h2 className="mb-3 text-lg font-semibold">
            <Users className="mr-2 inline size-5" />
            Members with this role ({role.memberCount})
          </h2>
          {role.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No members have this role.
            </p>
          ) : (
            <ul className="space-y-2">
              {role.members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {m.preferredName ?? m.email}
                  </span>
                  <span className="text-muted-foreground">{m.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── description editor ─────────────────────────────────────────────────

function DescriptionEditor({
  roleId,
  initial,
}: {
  roleId: string;
  initial: string | null;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initial ?? "");
  const [dirty, setDirty] = useState(false);

  // Reset when the role data changes (e.g. after navigation).
  useEffect(() => {
    setValue(initial ?? "");
    setDirty(false);
  }, [initial]);

  const mutation = useMutation({
    mutationFn: () =>
      updateRoleFn({
        data: { roleId, description: value.trim() || null },
      }),
    onSuccess: async () => {
      setDirty(false);
      await queryClient.invalidateQueries({
        queryKey: roleQueryKey(roleId),
      });
      await queryClient.invalidateQueries({
        queryKey: ["rbac", "roles"],
      });
    },
  });

  return (
    <div className="space-y-2">
      <Label htmlFor="role-description">Description</Label>
      <Textarea
        id="role-description"
        placeholder="What this role is for…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
        }}
        maxLength={200}
        rows={2}
      />
      {dirty ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue(initial ?? "");
              setDirty(false);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      {mutation.isError ? (
        <p className="text-sm text-destructive">{mutation.error.message}</p>
      ) : null}
    </div>
  );
}

// ── permission grants ──────────────────────────────────────────────────

function PermissionGrants({
  role,
  permissions,
}: {
  role: RoleDetail;
  permissions: PermissionSummary[];
}) {
  const queryClient = useQueryClient();
  const isAdmin = role.name === "system_admin";

  const mutation = useMutation({
    mutationFn: (permissionIds: string[]) =>
      setRolePermissionsFn({ data: { roleId: role.id, permissionIds } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: roleQueryKey(role.id),
      });
      await queryClient.invalidateQueries({
        queryKey: ["rbac", "roles"],
      });
    },
  });

  function handleToggle(permId: string, checked: boolean) {
    const current = new Set(role.permissionIds);
    if (checked) {
      current.add(permId);
    } else {
      current.delete(permId);
    }
    mutation.mutate(Array.from(current));
  }

  // Group by prefix.
  const grouped = new Map<string, PermissionSummary[]>();
  for (const p of permissions) {
    const group = p.name.split(":")[0] ?? p.name;
    const list = grouped.get(group) ?? [];
    list.push(p);
    grouped.set(group, list);
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">Permissions</h2>
      {isAdmin ? (
        <p className="text-sm text-muted-foreground">
          System admin automatically receives all permissions. This cannot be
          changed.
        </p>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([group, perms]) => (
            <div key={group}>
              <h3 className="mb-2 text-sm font-medium capitalize text-muted-foreground">
                {group}
              </h3>
              <div className="space-y-2">
                {perms.map((p) => {
                  const granted = role.permissionIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex items-start gap-3 rounded-md border px-3 py-2"
                    >
                      <Checkbox
                        checked={granted}
                        disabled={mutation.isPending}
                        onCheckedChange={(checked) =>
                          handleToggle(p.id, checked === true)
                        }
                        className="mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium">{p.name}</span>
                        {p.description ? (
                          <p className="text-xs text-muted-foreground">
                            {p.description}
                          </p>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
