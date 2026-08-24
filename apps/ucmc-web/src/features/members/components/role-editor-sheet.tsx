import { useQuery } from "@tanstack/react-query";
import { Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#/components/ui/accordion";
import { Badge } from "#/components/ui/badge";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { useAuth } from "#/features/auth/api/use-auth";
import {
  permissionsQueryOptions,
  roleQueryOptions,
} from "#/features/members/api/queries";
import { useSetRoleMembers } from "#/features/members/api/use-set-role-members";
import { useSetRolePermissions } from "#/features/members/api/use-set-role-permissions";
import { useUpdateRole } from "#/features/members/api/use-update-role";
import type { PickedMember } from "#/features/members/components/role-member-picker";
import { RoleMemberPicker } from "#/features/members/components/role-member-picker";
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

/** Label a member row prefers: their chosen name, else their email. */
function memberLabel(m: PickedMember): string {
  return m.preferredName ?? m.email;
}

/**
 * Everything the three tabs stage locally, plus the server baselines
 * they diff against. Snapshotted into a ref (see `latestRef`) so a
 * mutation's `onSuccess` can judge the *other* tabs' dirtiness from
 * what the user has typed since the mutation began.
 */
interface EditorState {
  initialized: boolean;
  pendingGrants: Set<string>;
  baselineGrants: Set<string>;
  pendingMemberIds: Set<string>;
  baselineMemberIds: Set<string>;
  description: string;
  baselineDescription: string;
  displayName: string;
  baselineDisplayName: string;
  isOfficer: boolean;
  baselineIsOfficer: boolean;
}

/**
 * Per-tab dirty flags derived from one state snapshot. Factored out
 * because each tab's save has to ask whether the *others* are still
 * dirty before auto-closing the sheet — with three tabs that's three
 * call sites that would otherwise each re-derive the other two by
 * hand, and any drift between the copies would either strand pending
 * edits or close over them.
 *
 * Metadata compares trim-symmetric on both sides so a trailing space
 * alone doesn't flip dirty: the server trims on persist, so a
 * baseline never carries whitespace and a typed trailing space
 * shouldn't ride a saved-clean state back into dirty after save.
 */
function computeDirty(s: EditorState) {
  if (!s.initialized) {
    return { permissions: false, members: false, metadata: false };
  }
  return {
    permissions: !setsEqual(s.pendingGrants, s.baselineGrants),
    members: !setsEqual(s.pendingMemberIds, s.baselineMemberIds),
    metadata:
      s.description.trim() !== s.baselineDescription ||
      s.displayName.trim() !== s.baselineDisplayName ||
      s.isOfficer !== s.baselineIsOfficer,
  };
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
  const isMemberRole = roleName === "member";

  const { hasPermission } = useAuth();
  // Writing `user_roles` rows answers to `roles:assign`, not the
  // `roles:manage` that gates /access itself. The two only travel
  // together by seed (system_admin holds both); a role delegated just
  // `roles:manage` at /access gets a read-only Members tab.
  const canAssign = hasPermission("roles:assign");

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
  const setPermissions = useSetRolePermissions();

  // ── members tab state ─────────────────────────────────────────────────
  // Staged like the other two tabs: adds and removes accumulate until
  // Save. `memberRows` is keyed by userId and only ever grows, so a
  // member removed and then re-added still has a label to render
  // without refetching the role.
  const [baselineMemberIds, setBaselineMemberIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pendingMemberIds, setPendingMemberIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [memberRows, setMemberRows] = useState<Map<string, PickedMember>>(
    () => new Map(),
  );
  const setRoleMembers = useSetRoleMembers();
  const [confirmMembersOpen, setConfirmMembersOpen] = useState(false);

  // ── metadata tab state ────────────────────────────────────────────────
  const [description, setDescription] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baselineDisplayName, setBaselineDisplayName] = useState("");
  const [isOfficer, setIsOfficer] = useState(false);
  const [baselineIsOfficer, setBaselineIsOfficer] = useState(false);
  const updateRole = useUpdateRole();

  // Initialize local edit state and baselines once per open session.
  // We deliberately do NOT depend on role.permissionIds /
  // role.description / role.members here: a background refetch (or
  // another mutation invalidating the cache) would otherwise wipe
  // whatever the user is mid-edit on. State resets on close so the
  // next open re-inits.
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
    const memberIds = new Set(role.members.map((m) => m.userId));
    setBaselineMemberIds(memberIds);
    setPendingMemberIds(memberIds);
    setMemberRows(new Map(role.members.map((m) => [m.userId, m])));
    setBaselineDescription(role.description ?? "");
    setDescription(role.description ?? "");
    setBaselineDisplayName(role.displayName);
    setDisplayName(role.displayName);
    setBaselineIsOfficer(role.isOfficer);
    setIsOfficer(role.isOfficer);
    setTab(initialTab);
    setInitialized(true);
  }, [open, role, initialTab, initialized]);

  const state: EditorState = {
    initialized,
    pendingGrants,
    baselineGrants,
    pendingMemberIds,
    baselineMemberIds,
    description,
    baselineDescription,
    displayName,
    baselineDisplayName,
    isOfficer,
    baselineIsOfficer,
  };
  const dirty = computeDirty(state);
  const anyDirty = dirty.permissions || dirty.members || dirty.metadata;

  // Latest-state ref so a mutation's onSuccess can decide whether to
  // close based on what the user has typed since the mutation began,
  // not what was on screen at click time. (The other tabs stay
  // editable while a save is in-flight, so the closure value can be
  // stale by the time onSuccess fires.)
  const latestRef = useRef(state);
  useEffect(() => {
    latestRef.current = state;
  });

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

  function addMember(member: PickedMember) {
    setMemberRows((prev) => new Map(prev).set(member.userId, member));
    setPendingMemberIds((prev) => new Set(prev).add(member.userId));
  }

  function removeMember(userId: string) {
    setPendingMemberIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }

  // Only auto-close when nothing else is left to save. If another tab
  // still has pending edits, stay open so the user can review them
  // rather than silently losing their work on close.
  function closeIfOthersClean(...others: (keyof typeof dirty)[]) {
    const latest = computeDirty(latestRef.current);
    if (others.every((k) => !latest[k])) {
      onOpenChange(false);
    }
  }

  function handleSavePermissions() {
    const savedGrants = new Set(pendingGrants);
    setPermissions.mutate(
      { roleId, permissionIds: Array.from(savedGrants) },
      {
        onSuccess: () => {
          // Roll baseline forward so this tab reads "clean" if the
          // sheet stays open for another tab's save.
          setBaselineGrants(savedGrants);
          closeIfOthersClean("members", "metadata");
        },
      },
    );
  }

  function handleSaveMembers() {
    const savedIds = new Set(pendingMemberIds);
    setRoleMembers.mutate(
      { roleId, userIds: Array.from(savedIds) },
      {
        onSuccess: () => {
          setBaselineMemberIds(savedIds);
          setConfirmMembersOpen(false);
          closeIfOthersClean("permissions", "metadata");
        },
      },
    );
  }

  function handleSaveMetadata() {
    const trimmedDescription = description.trim();
    const trimmedDisplayName = displayName.trim();
    if (trimmedDisplayName.length === 0) {
      return;
    }
    updateRole.mutate(
      {
        roleId,
        description: trimmedDescription || null,
        displayName: trimmedDisplayName,
        isOfficer,
      },
      {
        onSuccess: () => {
          setBaselineDescription(trimmedDescription);
          setDescription(trimmedDescription);
          setBaselineDisplayName(trimmedDisplayName);
          setDisplayName(trimmedDisplayName);
          setBaselineIsOfficer(isOfficer);
          closeIfOthersClean("permissions", "members");
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

  const isPending =
    setPermissions.isPending ||
    updateRole.isPending ||
    setRoleMembers.isPending;

  // The member role is read-only here on purpose: every approved
  // account holds it automatically (the server re-adds it on any
  // user-keyed save), so an X on those rows would silently no-op.
  const membersEditable = canAssign && !isAnonymous && !isMemberRole;

  const stagedMembers = useMemo(() => {
    const rows: PickedMember[] = [];
    for (const userId of pendingMemberIds) {
      const row = memberRows.get(userId);
      if (row) {
        rows.push(row);
      }
    }
    return rows.sort((a, b) =>
      memberLabel(a).localeCompare(memberLabel(b), "en", {
        sensitivity: "base",
      }),
    );
  }, [pendingMemberIds, memberRows]);

  const addedCount = [...pendingMemberIds].filter(
    (id) => !baselineMemberIds.has(id),
  ).length;
  const removedCount = [...baselineMemberIds].filter(
    (id) => !pendingMemberIds.has(id),
  ).length;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{role?.displayName ?? roleName}</SheetTitle>
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
              className="flex min-h-0 flex-1 flex-col px-4 pt-3"
            >
              {isLoading || !initialized ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {stagedMembers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No members have this role.
                      </p>
                    ) : (
                      <>
                        <p className="pb-2 text-xs text-muted-foreground">
                          {stagedMembers.length} member(s) with this role.
                        </p>
                        <ul className="space-y-2">
                          {stagedMembers.map((m) => {
                            const isNew = !baselineMemberIds.has(m.userId);
                            return (
                              <li
                                key={m.userId}
                                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                              >
                                <UserRound className="size-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate font-medium">
                                      {m.preferredName ?? m.email}
                                    </span>
                                    {isNew ? (
                                      <Badge
                                        variant="secondary"
                                        className="shrink-0 text-xs"
                                      >
                                        to add
                                      </Badge>
                                    ) : null}
                                  </div>
                                  {m.preferredName ? (
                                    <p className="truncate text-xs text-muted-foreground">
                                      {m.email}
                                    </p>
                                  ) : null}
                                </div>
                                {membersEditable ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8 shrink-0"
                                        disabled={isPending}
                                        onClick={() => removeMember(m.userId)}
                                        aria-label={`Remove ${memberLabel(m)} from this role`}
                                      >
                                        <Trash2 className="size-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Remove</TooltipContent>
                                  </Tooltip>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </div>

                  <div className="shrink-0 space-y-2 border-t pt-3">
                    {membersEditable ? (
                      <>
                        <RoleMemberPicker
                          excludeUserIds={pendingMemberIds}
                          onPick={addMember}
                          disabled={isPending || Boolean(loadFailed)}
                        />
                        {addedCount > 0 || removedCount > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {addedCount > 0 ? `${addedCount} to add` : null}
                            {addedCount > 0 && removedCount > 0 ? " · " : null}
                            {removedCount > 0
                              ? `${removedCount} to remove`
                              : null}
                            . Save to apply.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {isMemberRole
                          ? "Every approved account holds the member role automatically. Change a member’s status from /members instead."
                          : "Changing who holds a role needs the roles:assign permission."}
                      </p>
                    )}
                    {setRoleMembers.isError ? (
                      <p className="text-sm text-destructive">
                        {setRoleMembers.error.message}
                      </p>
                    ) : null}
                  </div>
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
            ) : !initialized ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : permissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No permissions defined.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {pendingGrants.size} of {permissions.length} permissions
                  granted. Expand a group to change it.
                </p>
                {/* Collapsed by default with the granted count on every
                    header, so the whole catalog — ~14 groups — is
                    scannable without expanding anything. `type="multiple"`
                    lets several groups stay open while comparing. */}
                <Accordion
                  type="multiple"
                  className="rounded-md border divide-y"
                >
                  {Array.from(grouped.entries()).map(([group, perms]) => {
                    const grantedCount = perms.filter((p) =>
                      pendingGrants.has(p.id),
                    ).length;
                    return (
                      <AccordionItem
                        key={group}
                        value={group}
                        className="border-b-0 px-3"
                      >
                        <AccordionTrigger className="py-3 hover:no-underline">
                          <span className="flex flex-1 items-center justify-between gap-3">
                            <span className="font-medium">{group}</span>
                            <Badge
                              variant={
                                grantedCount > 0 ? "secondary" : "outline"
                              }
                              className="shrink-0 tabular-nums"
                            >
                              {grantedCount} / {perms.length}
                            </Badge>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-2 pb-3">
                          {perms.map((p) => {
                            const granted = pendingGrants.has(p.id);
                            return (
                              <label
                                key={p.id}
                                className="flex items-start gap-3 rounded-md border px-3 py-2"
                              >
                                <Checkbox
                                  checked={granted}
                                  disabled={
                                    setPermissions.isPending || !initialized
                                  }
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
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </>
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
              <Label htmlFor="role-meta-display-name">Display name</Label>
              <Input
                id="role-meta-display-name"
                placeholder="e.g. Trip Leader"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
                disabled={isAdmin || !initialized}
              />
              <p className="text-xs text-muted-foreground">
                {isAdmin
                  ? "The system_admin role’s label is fixed."
                  : "Shown wherever this role is presented to members, and on the public home page when the role is flagged as an officer position."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-meta-name">Identifier</Label>
              <Input
                id="role-meta-name"
                value={roleName}
                readOnly
                className="bg-muted/40"
              />
              <p className="text-xs text-muted-foreground">
                Identifiers are immutable.
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
                disabled={isAdmin || !initialized}
              />
              {isAdmin ? (
                <p className="text-xs text-muted-foreground">
                  The system_admin role&rsquo;s description is fixed.
                </p>
              ) : null}
            </div>
            {!isAnonymous ? (
              <label
                htmlFor="role-meta-is-officer"
                className="flex items-start gap-3 rounded-md border px-3 py-2"
              >
                <Checkbox
                  id="role-meta-is-officer"
                  checked={isOfficer}
                  disabled={isAdmin || !initialized}
                  onCheckedChange={(checked) => setIsOfficer(checked === true)}
                  className="mt-0.5"
                />
                <div>
                  <span className="text-sm font-medium">Officer position</span>
                  <p className="text-xs text-muted-foreground">
                    {isAdmin
                      ? "system_admin cannot be flagged as an officer position."
                      : "Show members holding this role on the public “Meet the officers” section of the home page."}
                  </p>
                </div>
              </label>
            ) : null}
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
            {tab === "members" && !membersEditable ? "Close" : "Cancel"}
          </Button>
          {tab === "members" && membersEditable ? (
            <Button
              type="button"
              onClick={() => {
                // Granting system_admin hands over every permission on
                // the site, so it gets an explicit confirmation rather
                // than riding the same one-click Save as a trip-leader
                // role. Everything else saves straight through.
                if (isAdmin) {
                  setConfirmMembersOpen(true);
                  return;
                }
                handleSaveMembers();
              }}
              disabled={!dirty.members || isPending || Boolean(loadFailed)}
            >
              {setRoleMembers.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
          {tab === "permissions" ? (
            <Button
              type="button"
              onClick={handleSavePermissions}
              disabled={
                isAdmin || !dirty.permissions || isPending || loadFailed
              }
            >
              {setPermissions.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
          {tab === "metadata" ? (
            <Button
              type="button"
              onClick={handleSaveMetadata}
              disabled={
                !dirty.metadata ||
                isPending ||
                Boolean(loadFailed) ||
                displayName.trim().length === 0
              }
            >
              {updateRole.isPending ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </SheetFooter>

        <AlertDialog
          open={confirmMembersOpen}
          onOpenChange={setConfirmMembersOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Change who holds system_admin?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {addedCount > 0
                  ? `Granting system_admin to ${addedCount} member(s) gives them every permission on the site, including this page. `
                  : null}
                {removedCount > 0
                  ? `Removing it from ${removedCount} member(s) revokes their platform-wide access. `
                  : null}
                This is the highest level of access there is.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={setRoleMembers.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  // Keep the dialog mounted while the mutation runs so
                  // a failure surfaces on the tab behind it rather than
                  // vanishing with the dialog.
                  e.preventDefault();
                  handleSaveMembers();
                }}
                disabled={setRoleMembers.isPending}
              >
                {setRoleMembers.isPending ? "Saving…" : "Apply"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
