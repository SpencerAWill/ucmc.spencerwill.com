import { useQuery } from "@tanstack/react-query";
import { ChevronDown, HelpCircle, Shield } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import {
  permissionsQueryOptions,
  rolesDetailedQueryOptions,
} from "#/features/members/api/queries";
import { useBulkSetRolePermissions } from "#/features/members/api/use-bulk-set-role-permissions";
import type {
  PermissionSummary,
  RoleWithPermissions,
} from "#/features/members/server/rbac-fns";

const SYSTEM_ADMIN_ROLE_NAME = "system_admin";

/** Group permissions by the prefix before the colon (e.g. "roles" from "roles:manage"). */
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

export function PermissionMatrixEditor() {
  const { data: roles = [], isLoading: rolesLoading } = useQuery(
    rolesDetailedQueryOptions(),
  );
  const { data: permissions = [], isLoading: permsLoading } = useQuery(
    permissionsQueryOptions(),
  );

  // Pending overrides per role: presence in this map means "this role's
  // grants have been edited and should be saved as the contained Set."
  // Roles whose grants have not been edited stay out of the map.
  const [pending, setPending] = useState<Map<string, Set<string>>>(new Map());

  const serverGrants = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const role of roles) {
      m.set(role.id, new Set(role.permissionIds));
    }
    return m;
  }, [roles]);

  const grouped = useMemo(() => groupPermissions(permissions), [permissions]);

  const dirtyRoleCount = pending.size;
  const dirtyEditCount = useMemo(() => {
    let total = 0;
    for (const [roleId, set] of pending) {
      const server = serverGrants.get(roleId);
      if (!server) {
        continue;
      }
      total += symmetricDifferenceSize(set, server);
    }
    return total;
  }, [pending, serverGrants]);

  const mutation = useBulkSetRolePermissions();

  function effectiveGrants(role: RoleWithPermissions): Set<string> {
    return pending.get(role.id) ?? serverGrants.get(role.id) ?? new Set();
  }

  function toggle(role: RoleWithPermissions, permId: string, checked: boolean) {
    if (role.name === SYSTEM_ADMIN_ROLE_NAME) {
      return;
    }
    setPending((prev) => {
      const next = new Map(prev);
      const current = new Set(
        next.get(role.id) ?? serverGrants.get(role.id) ?? [],
      );
      if (checked) {
        current.add(permId);
      } else {
        current.delete(permId);
      }
      // If the new set matches the server, drop the pending entry so this
      // row is no longer dirty (covers toggle-then-toggle-back).
      const server = serverGrants.get(role.id);
      if (server && setsEqual(current, server)) {
        next.delete(role.id);
      } else {
        next.set(role.id, current);
      }
      return next;
    });
  }

  function handleSave() {
    if (dirtyRoleCount === 0) {
      return;
    }
    const payload = Array.from(pending.entries()).map(([roleId, set]) => ({
      roleId,
      permissionIds: Array.from(set),
    }));
    mutation.mutate(
      { roles: payload },
      {
        onSuccess: () => {
          setPending(new Map());
        },
      },
    );
  }

  function handleDiscard() {
    setPending(new Map());
  }

  if (rolesLoading || permsLoading) {
    return (
      <div className="text-sm text-muted-foreground">Loading permissions…</div>
    );
  }

  if (permissions.length === 0 || roles.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No roles or permissions to display.
      </div>
    );
  }

  return (
    <>
      <p className="pb-3 text-sm text-muted-foreground">
        Toggle permissions across roles, then save once. System admin always has
        all permissions.
      </p>

      {/* Mobile: per-role accordion */}
      <div className="space-y-2 md:hidden">
        {roles.map((role) => {
          const isAdmin = role.name === SYSTEM_ADMIN_ROLE_NAME;
          const server = serverGrants.get(role.id) ?? new Set<string>();
          const current = effectiveGrants(role);
          const dirtyForRole = isAdmin
            ? 0
            : symmetricDifferenceSize(current, server);
          return (
            <Collapsible key={role.id}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50 [&[data-state=open]>div>svg.chev]:rotate-180">
                <div className="flex min-w-0 items-center gap-2">
                  <Shield className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{role.name}</span>
                  {isAdmin ? (
                    <Badge variant="secondary" className="text-xs">
                      All
                    </Badge>
                  ) : dirtyForRole > 0 ? (
                    <Badge variant="outline" className="text-xs">
                      {dirtyForRole} pending
                    </Badge>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {isAdmin ? "—" : `${current.size}/${permissions.length}`}
                  </span>
                  <ChevronDown className="chev size-4 transition-transform" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 px-1 pb-1 pt-2">
                  {isAdmin ? (
                    <p className="px-2 text-xs text-muted-foreground">
                      System admin automatically receives all permissions.
                    </p>
                  ) : (
                    Array.from(grouped.entries()).map(([group, perms]) => (
                      <div key={group}>
                        <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {group}
                        </p>
                        {perms.map((perm) => {
                          const granted = current.has(perm.id);
                          const serverHas = server.has(perm.id);
                          const dirty = granted !== serverHas;
                          return (
                            <label
                              key={perm.id}
                              className={`flex items-start gap-3 rounded-md px-2 py-1.5 ${
                                dirty ? "bg-amber-50 dark:bg-amber-950/30" : ""
                              }`}
                            >
                              <Checkbox
                                checked={granted}
                                onCheckedChange={(checked) =>
                                  toggle(role, perm.id, checked === true)
                                }
                                className="mt-0.5"
                                aria-label={`${role.name} · ${perm.name}`}
                              />
                              <div className="min-w-0">
                                <div className="text-sm">
                                  {perm.name.split(":")[1] ?? perm.name}
                                </div>
                                {perm.description ? (
                                  <p className="text-xs text-muted-foreground">
                                    {perm.description}
                                  </p>
                                ) : null}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>

      {/* Desktop: matrix */}
      <div className="hidden overflow-x-auto rounded-md border md:block">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 min-w-40 border-b bg-background px-3 py-2 text-left align-bottom font-medium">
                Permission
              </th>
              {roles.map((role) => (
                <th
                  key={role.id}
                  className="sticky top-0 h-32 border-b border-l bg-background align-bottom"
                  style={{ width: 36, minWidth: 36 }}
                >
                  <div className="flex h-full items-end justify-center pb-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="cursor-help whitespace-nowrap text-xs"
                          style={{
                            writingMode: "vertical-rl",
                            transform: "rotate(180deg)",
                          }}
                        >
                          {role.name}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {role.description ?? role.name}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(grouped.entries()).map(([group, perms]) => (
              <Fragment key={group}>
                <tr>
                  <td
                    colSpan={roles.length + 1}
                    className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {group}
                  </td>
                </tr>
                {perms.map((perm) => (
                  <tr key={perm.id} className="hover:bg-muted/30">
                    <td className="sticky left-0 z-10 border-b bg-background px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">
                          {perm.name.split(":")[1] ?? perm.name}
                        </span>
                        {perm.description ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={`About ${perm.name}`}
                              >
                                <HelpCircle className="size-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              {perm.description}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </td>
                    {roles.map((role) => {
                      const isAdmin = role.name === SYSTEM_ADMIN_ROLE_NAME;
                      const current = effectiveGrants(role);
                      const granted = isAdmin ? true : current.has(perm.id);
                      const serverHas =
                        serverGrants.get(role.id)?.has(perm.id) ?? false;
                      const dirty = !isAdmin && granted !== serverHas;
                      return (
                        <td
                          key={role.id}
                          className={`border-b border-l text-center align-middle ${
                            dirty ? "bg-amber-50 dark:bg-amber-950/30" : ""
                          }`}
                          style={{ width: 36 }}
                        >
                          <Checkbox
                            checked={granted}
                            disabled={isAdmin}
                            onCheckedChange={(checked) =>
                              toggle(role, perm.id, checked === true)
                            }
                            aria-label={`${role.name} · ${perm.name}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {dirtyRoleCount > 0 ? (
        <div className="sticky bottom-0 mt-4 -mx-4 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <span className="text-sm text-muted-foreground">
            <Badge variant="secondary" className="mr-2">
              {dirtyEditCount}
            </Badge>
            {dirtyEditCount === 1 ? "edit" : "edits"} across {dirtyRoleCount}{" "}
            {dirtyRoleCount === 1 ? "role" : "roles"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDiscard}
              disabled={mutation.isPending}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Saving…" : "Save permissions"}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
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

function symmetricDifferenceSize(a: Set<string>, b: Set<string>): number {
  let diff = 0;
  for (const v of a) {
    if (!b.has(v)) {
      diff++;
    }
  }
  for (const v of b) {
    if (!a.has(v)) {
      diff++;
    }
  }
  return diff;
}
