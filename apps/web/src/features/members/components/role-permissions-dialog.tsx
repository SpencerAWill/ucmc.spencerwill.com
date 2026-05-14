import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import {
  permissionsQueryOptions,
  roleQueryOptions,
} from "#/features/members/api/queries";
import { useSetRolePermissions } from "#/features/members/api/use-set-role-permissions";
import type { PermissionSummary } from "#/features/members/server/rbac-fns";

const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. Leave and discard them?";

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

export function RolePermissionsDialog({
  roleId,
  roleName,
  open,
  onOpenChange,
}: {
  roleId: string;
  roleName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isAdmin = roleName === "system_admin";

  const { data: role } = useQuery({
    ...roleQueryOptions(roleId),
    enabled: open,
  });
  const { data: permissions = [] } = useQuery({
    ...permissionsQueryOptions(),
    enabled: open,
  });

  const serverGrants = useMemo(
    () => new Set(role?.permissionIds ?? []),
    [role?.permissionIds],
  );
  const [pending, setPending] = useState<Set<string>>(serverGrants);

  useEffect(() => {
    if (open) {
      setPending(new Set(role?.permissionIds ?? []));
    }
  }, [open, role?.permissionIds]);

  const grouped = useMemo(() => groupPermissions(permissions), [permissions]);
  const dirty = !setsEqual(pending, serverGrants);

  const mutation = useSetRolePermissions();

  function toggle(permId: string, checked: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(permId);
      } else {
        next.delete(permId);
      }
      return next;
    });
  }

  function handleSave() {
    mutation.mutate(
      { roleId, permissionIds: Array.from(pending) },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  function handleOpenChange(next: boolean) {
    if (!next && dirty && !window.confirm(UNSAVED_CHANGES_MESSAGE)) {
      return;
    }
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Permissions · {roleName}</SheetTitle>
          <SheetDescription>
            {isAdmin
              ? "System admin automatically receives all permissions."
              : "Toggle the permissions this role grants."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4">
          {isAdmin ? (
            <p className="text-sm text-muted-foreground">
              This cannot be changed.
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
                    const granted = pending.has(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex items-start gap-3 rounded-md border px-3 py-2"
                      >
                        <Checkbox
                          checked={granted}
                          disabled={mutation.isPending}
                          onCheckedChange={(checked) =>
                            toggle(p.id, checked === true)
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
            ))
          )}
          {mutation.isError ? (
            <p className="text-sm text-destructive">{mutation.error.message}</p>
          ) : null}
        </div>

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isAdmin || !dirty || mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
