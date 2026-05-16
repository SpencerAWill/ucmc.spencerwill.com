import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

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

  const {
    data: role,
    isLoading,
    isError: roleError,
    error: roleErrorValue,
  } = useQuery({
    ...roleQueryOptions(roleId),
    enabled: open,
  });

  const {
    data: permissions = [],
    isError: permsError,
    error: permsErrorValue,
  } = useQuery({
    ...permissionsQueryOptions(),
    enabled: open,
  });

  // Don't auto-close on query error: if a user has typed into the
  // Details tab and the role goes missing, they should keep their
  // work so they can copy it out. Inline error + disabled Save below
  // is the affordance; closing flows through the unsaved-changes
  // guard like any other close.
  const loadFailed = roleError || permsError;

  const [tab, setTab] = useState<TabValue>(initialTab);

  // Baselines snapshot the server values at init time. Dirty flags
  // compare against these snapshots — never directly against the live
  // role query — so a background refetch can't briefly desync the
  // baseline from the pending state and flip Save to "dirty" before
  // the user has touched anything.
  const [initialized, setInitialized] = useState(false);
  const [baselineGrants, setBaselineGrants] = useState<Set<string>>(
    () => new Set(),
  );
  const [baselineDescription, setBaselineDescription] = useState("");

  // ── permissions tab state ─────────────────────────────────────────────
  const [pendingGrants, setPendingGrants] = useState<Set<string>>(
    () => new Set(),
  );
  const grouped = useMemo(() => groupPermissions(permissions), [permissions]);
  const permsDirty = initialized && !setsEqual(pendingGrants, baselineGrants);
  const setPermissions = useSetRolePermissions();

  // ── metadata tab state ────────────────────────────────────────────────
  const [description, setDescription] = useState("");
  const metadataDirty = initialized && description !== baselineDescription;
  const updateRole = useUpdateRole();

  // Initialize local edit state and baselines once per open session.
  // We deliberately do NOT depend on role.permissionIds /
  // role.description here: a background refetch (or another mutation
  // invalidating the cache) would otherwise wipe whatever the user is
  // mid-edit on. State resets on close so the next open re-inits.
  useEffect(() => {
    if (!open) {
      setInitialized(false);
      return;
    }
    if (initialized) return;
    if (!role) return;
    const grants = new Set(role.permissionIds);
    setBaselineGrants(grants);
    setPendingGrants(grants);
    setBaselineDescription(role.description ?? "");
    setDescription(role.description ?? "");
    setTab(initialTab);
    setInitialized(true);
  }, [open, role, initialTab, initialized]);

  const anyDirty = permsDirty || metadataDirty;

  // Latest-state refs so a mutation's onSuccess can decide whether to
  // close based on what the user has typed since the mutation began,
  // not what was on screen at click time. (The other tab stays
  // editable while a save is in-flight, so the closure value can be
  // stale by the time onSuccess fires.)
  const latestRef = useRef({
    pendingGrants,
    description,
    baselineGrants,
    baselineDescription,
    initialized,
  });
  useEffect(() => {
    latestRef.current = {
      pendingGrants,
      description,
      baselineGrants,
      baselineDescription,
      initialized,
    };
  }, [
    pendingGrants,
    description,
    baselineGrants,
    baselineDescription,
    initialized,
  ]);

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

  // Only auto-close when nothing else is left to save. If another tab
  // still has pending edits, stay open so the user can review them
  // rather than silently losing their work on close.
  function handleSavePermissions() {
    const savedGrants = new Set(pendingGrants);
    setPermissions.mutate(
      { roleId, permissionIds: Array.from(savedGrants) },
      {
        onSuccess: () => {
          // Roll baseline forward so this tab reads "clean" if the
          // sheet stays open for the other tab's save.
          setBaselineGrants(savedGrants);
          // Re-derive metadata-dirty from the latest state, not the
          // closure captured at click time — the user could have kept
          // typing in the description tab while the mutation was
          // in-flight.
          const latest = latestRef.current;
          const stillDirty =
            latest.initialized &&
            latest.description !== latest.baselineDescription;
          if (!stillDirty) onOpenChange(false);
        },
      },
    );
  }

  function handleSaveMetadata() {
    const trimmed = description.trim();
    updateRole.mutate(
      { roleId, description: trimmed || null },
      {
        onSuccess: () => {
          setBaselineDescription(trimmed);
          setDescription(trimmed);
          const latest = latestRef.current;
          const stillDirty =
            latest.initialized &&
            !setsEqual(latest.pendingGrants, latest.baselineGrants);
          if (!stillDirty) onOpenChange(false);
        },
      },
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
            {isAnonymous
              ? "Manage the permissions granted to signed-out visitors."
              : "Manage members, permissions, and details for this role."}
          </SheetDescription>
        </SheetHeader>

        {loadFailed ? (
          <div className="px-4 pt-2">
            <p className="text-sm text-destructive">
              {roleError
                ? `Couldn't load this role${
                    roleErrorValue instanceof Error
                      ? `: ${roleErrorValue.message}`
                      : "."
                  }`
                : `Couldn't load the permissions catalog${
                    permsErrorValue instanceof Error
                      ? `: ${permsErrorValue.message}`
                      : "."
                  }`}
            </p>
          </div>
        ) : null}

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
                Details
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
              disabled={isAdmin || !permsDirty || isPending || loadFailed}
            >
              {setPermissions.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
          {tab === "metadata" ? (
            <Button
              type="button"
              onClick={handleSaveMetadata}
              disabled={isAdmin || !metadataDirty || isPending || loadFailed}
            >
              {updateRole.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
