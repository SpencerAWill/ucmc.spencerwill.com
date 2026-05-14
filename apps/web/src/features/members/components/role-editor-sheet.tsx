import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import {
  permissionsQueryOptions,
  roleQueryOptions,
} from "#/features/members/api/queries";
import { useSetRolePermissions } from "#/features/members/api/use-set-role-permissions";
import { useUpdateRole } from "#/features/members/api/use-update-role";
import type { PermissionSummary } from "#/features/members/server/rbac-fns";

const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. Leave and discard them?";

type TabValue = "members" | "permissions" | "metadata";

function groupPermissions(
  perms: PermissionSummary[],
): Map<string, PermissionSummary[]> {
  const map = new Map<string, PermissionSummary[]>();
  for (const p of perms) {
    const group = p.name.split(":")[0] ?? p.name;
    const list = map.get(group) ?? [];
    list.push(p);
    map.set(group, list);
  }
  return map;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const v of a) {
    if (!b.has(v)) {
      return false;
    }
  }
  return true;
}

export function RoleEditorSheet({
  roleId,
  roleName,
  open,
  onOpenChange,
  initialTab = "metadata",
}: {
  roleId: string;
  roleName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: TabValue;
}) {
  const isAdmin = roleName === "system_admin";
  const isAnonymous = roleName === "anonymous";

  const { data: role, isLoading } = useQuery({
    ...roleQueryOptions(roleId),
    enabled: open,
  });
  const { data: permissions = [] } = useQuery({
    ...permissionsQueryOptions(),
    enabled: open,
  });

  const [tab, setTab] = useState<TabValue>(initialTab);

  // ── permissions tab state ─────────────────────────────────────────────
  const serverGrants = useMemo(
    () => new Set(role?.permissionIds ?? []),
    [role?.permissionIds],
  );
  const [pendingGrants, setPendingGrants] = useState<Set<string>>(serverGrants);
  const grouped = useMemo(() => groupPermissions(permissions), [permissions]);
  const permsDirty = !setsEqual(pendingGrants, serverGrants);
  const setPermissions = useSetRolePermissions();

  // ── metadata tab state ────────────────────────────────────────────────
  const initialDescription = role?.description ?? "";
  const [description, setDescription] = useState(initialDescription);
  const metadataDirty = description !== initialDescription;
  const updateRole = useUpdateRole();

  // Reset local state whenever the sheet (re)opens against a role.
  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setPendingGrants(new Set(role?.permissionIds ?? []));
      setDescription(role?.description ?? "");
    }
  }, [open, role?.permissionIds, role?.description, initialTab]);

  const anyDirty = permsDirty || metadataDirty;

  function togglePerm(permId: string, checked: boolean) {
    setPendingGrants((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(permId);
      } else {
        next.delete(permId);
      }
      return next;
    });
  }

  function handleSavePermissions() {
    setPermissions.mutate(
      { roleId, permissionIds: Array.from(pendingGrants) },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  function handleSaveMetadata() {
    updateRole.mutate(
      { roleId, description: description.trim() || null },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  function handleOpenChange(next: boolean) {
    if (!next && anyDirty && !window.confirm(UNSAVED_CHANGES_MESSAGE)) {
      return;
    }
    onOpenChange(next);
  }

  const isPending = setPermissions.isPending || updateRole.isPending;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{roleName}</SheetTitle>
          <SheetDescription>
            Manage members, permissions, and metadata for this role.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabValue)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-4">
            <TabsList variant="line" className="w-full">
              {!isAnonymous ? (
                <TabsTrigger value="members" className="flex-1">
                  Members
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="permissions" className="flex-1">
                Permissions
              </TabsTrigger>
              <TabsTrigger value="metadata" className="flex-1">
                Edit
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Members */}
          {!isAnonymous ? (
            <TabsContent
              value="members"
              className="flex-1 overflow-y-auto px-4 pt-3"
            >
              {isLoading || !role ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : role.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No members have this role.
                </p>
              ) : (
                <>
                  <p className="pb-2 text-xs text-muted-foreground">
                    {role.memberCount} member(s) with this role.
                  </p>
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
                </>
              )}
            </TabsContent>
          ) : null}

          {/* Permissions */}
          <TabsContent
            value="permissions"
            className="flex-1 space-y-4 overflow-y-auto px-4 pt-3"
          >
            {isAdmin ? (
              <p className="text-sm text-muted-foreground">
                System admin automatically receives all permissions. This cannot
                be changed.
              </p>
            ) : permissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No permissions defined.
              </p>
            ) : (
              Array.from(grouped.entries()).map(([group, perms]) => (
                <div key={group}>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group}
                  </h3>
                  <div className="space-y-2">
                    {perms.map((p) => {
                      const granted = pendingGrants.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex items-start gap-3 rounded-md border px-3 py-2"
                        >
                          <Checkbox
                            checked={granted}
                            disabled={setPermissions.isPending}
                            onCheckedChange={(checked) =>
                              togglePerm(p.id, checked === true)
                            }
                            className="mt-0.5"
                          />
                          <div>
                            <span className="text-sm font-medium">
                              {p.name}
                            </span>
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
              ))
            )}
            {setPermissions.isError ? (
              <p className="text-sm text-destructive">
                {setPermissions.error.message}
              </p>
            ) : null}
          </TabsContent>

          {/* Metadata */}
          <TabsContent
            value="metadata"
            className="flex-1 space-y-4 overflow-y-auto px-4 pt-3"
          >
            <div className="space-y-2">
              <Label htmlFor="role-meta-name">Name</Label>
              <Input
                id="role-meta-name"
                value={roleName}
                readOnly
                className="bg-muted/40"
              />
              <p className="text-xs text-muted-foreground">
                Role names are immutable.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-meta-desc">Description</Label>
              <Textarea
                id="role-meta-desc"
                placeholder={
                  isAdmin
                    ? "System administrator with full platform control."
                    : "What this role is for…"
                }
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                rows={3}
                disabled={isAdmin}
              />
              {isAdmin ? (
                <p className="text-xs text-muted-foreground">
                  The system_admin role&rsquo;s description is fixed.
                </p>
              ) : null}
            </div>
            {updateRole.isError ? (
              <p className="text-sm text-destructive">
                {updateRole.error.message}
              </p>
            ) : null}
          </TabsContent>
        </Tabs>

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            {tab === "members" ? "Close" : "Cancel"}
          </Button>
          {tab === "permissions" ? (
            <Button
              type="button"
              onClick={handleSavePermissions}
              disabled={isAdmin || !permsDirty || isPending}
            >
              {setPermissions.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
          {tab === "metadata" ? (
            <Button
              type="button"
              onClick={handleSaveMetadata}
              disabled={isAdmin || !metadataDirty || isPending}
            >
              {updateRole.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
