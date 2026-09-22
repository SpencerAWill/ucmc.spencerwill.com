import { useQuery } from "@tanstack/react-query";
import {
  GripVertical,
  KeyRound,
  Pencil,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Sortable,
  SortableContent,
  SortableItem,
  SortableItemHandle,
} from "#/components/ui/sortable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { rolesDetailedQueryOptions } from "#/features/members/api/queries";
import { useDeleteRole } from "#/features/members/api/use-delete-role";
import { useReorderRoles } from "#/features/members/api/use-reorder-roles";
import { RoleEditorSheet } from "#/features/members/components/role-editor-sheet";
import type { RoleWithPermissions } from "#/features/members/server/rbac-fns";

export function RolesListEditor() {
  const [deleteTarget, setDeleteTarget] = useState<RoleWithPermissions | null>(
    null,
  );
  const [editorTarget, setEditorTarget] = useState<{
    roleId: string;
    roleName: string;
  } | null>(null);

  const { data: roles = [], isLoading } = useQuery(rolesDetailedQueryOptions());

  const serverOrder = useMemo(() => roles.map((r) => r.id), [roles]);
  const [order, setOrder] = useState<string[]>(serverOrder);

  // Reset local order whenever server data lands. We compare contents so a
  // reference change with the same ids doesn't churn the UI mid-edit.
  useEffect(() => {
    setOrder((prev) => {
      if (prev.length === serverOrder.length) {
        let same = true;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] !== serverOrder[i]) {
            same = false;
            break;
          }
        }
        if (same) {
          return prev;
        }
      }
      return serverOrder;
    });
  }, [serverOrder]);

  const rolesById = useMemo(() => {
    const m = new Map<string, RoleWithPermissions>();
    for (const r of roles) {
      m.set(r.id, r);
    }
    return m;
  }, [roles]);

  const orderDirty = useMemo(() => {
    if (order.length !== serverOrder.length) {
      return false;
    }
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== serverOrder[i]) {
        return true;
      }
    }
    return false;
  }, [order, serverOrder]);

  const reorderMutation = useReorderRoles();
  const deleteMutation = useDeleteRole();

  function handleSave() {
    reorderMutation.mutate({ orderedRoleIds: order });
  }

  function handleDiscard() {
    setOrder(serverOrder);
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading roles…</div>;
  }

  return (
    <>
      <Sortable
        value={order}
        onValueChange={setOrder}
        getItemLabel={(id) =>
          rolesById.get(String(id))?.displayName ?? String(id)
        }
      >
        <SortableContent asChild>
          <ul className="divide-y rounded-md border">
            {order.map((id) => {
              const role = rolesById.get(id);
              if (!role) {
                return null;
              }
              const isAdmin = role.name === "system_admin";
              const isAnonymous = role.name === "anonymous";
              return (
                <SortableItem
                  key={id}
                  value={id}
                  asChild
                  disabled={reorderMutation.isPending}
                >
                  <li className="flex items-center gap-2 bg-background px-3 py-2 data-dragging:bg-muted data-dragging:shadow-md">
                    <SortableItemHandle
                      aria-label={`Drag ${role.displayName}`}
                      className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <GripVertical className="size-4" />
                    </SortableItemHandle>

                    {/* Two lines: the display name, then a row of
                        chips. The role's *identifier* (`role.name`) used
                        to be the second line, and on a phone it was the
                        widest thing in the row while being the least
                        useful — nobody administering roles is matching
                        on `trip_leader` when "Trip Leader" sits directly
                        above it. Handing that line to the chips instead
                        pulls three of them out of the row's horizontal
                        run, which is what was squeezing the name. The
                        identifier still drives every behavioural branch
                        here; it is just no longer rendered. */}
                    <div className="min-w-0 flex-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate font-medium">
                            {role.displayName}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          {role.description ?? "No description."}
                        </TooltipContent>
                      </Tooltip>

                      {/* Counts as icon + number chips rather than
                          "7 member(s) / 11 perm(s)" prose: at a glance
                          the list is a comparison between roles, and two
                          narrow tabular-nums chips scan down the column
                          in a way wrapped prose doesn't. The tooltip
                          carries the wording for sighted users;
                          `role="img"` + aria-label carries it for screen
                          readers, which never reach a tooltip on a
                          non-focusable badge. The role is load-bearing:
                          `Badge` renders a bare <span>, and aria-label
                          is ignored on an element left with the implicit
                          `generic` role. */}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {role.isOfficer ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="secondary"
                                className="gap-1 px-1.5 text-xs"
                                role="img"
                                aria-label="Officer role"
                              >
                                <Star className="size-3" />
                                officer
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              Surfaces on the public home page
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="secondary"
                              className="gap-1 px-1.5 tabular-nums"
                              role="img"
                              aria-label={
                                isAnonymous
                                  ? "Not applicable to members"
                                  : `${role.memberCount} member(s)`
                              }
                            >
                              <Users className="size-3" />
                              {isAnonymous ? "—" : role.memberCount}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {isAnonymous
                              ? "Applies to signed-out visitors, so it has no members"
                              : `${role.memberCount} member(s) hold this role`}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="secondary"
                              className="gap-1 px-1.5 tabular-nums"
                              role="img"
                              aria-label={
                                isAdmin
                                  ? "All permissions"
                                  : `${role.permissionIds.length} permission(s)`
                              }
                            >
                              <KeyRound className="size-3" />
                              {isAdmin ? "All" : role.permissionIds.length}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {isAdmin
                              ? "System admin automatically holds every permission"
                              : `${role.permissionIds.length} permission(s) granted`}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setEditorTarget({
                                roleId: role.id,
                                roleName: role.name,
                              })
                            }
                            aria-label={`Edit ${role.displayName}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit</TooltipContent>
                      </Tooltip>
                      {/* A protected role keeps its trash icon, greyed
                          out, instead of the row carrying a "protected"
                          chip. The chip spent a slot in the row's
                          horizontal run stating a fact that only matters
                          at the moment someone reaches for delete — and
                          it left protected rows one control short, so
                          the action column didn't line up down the list.

                          `aria-disabled` rather than `disabled`, and
                          that is what makes the explanation reachable: a
                          `disabled` button takes no pointer events (so
                          the tooltip never opens) and no focus (so a
                          keyboard or screen-reader user never hears
                          why). This one stays hoverable and focusable
                          and refuses in its own handler. The tap path
                          gets a toast, because a phone has no hover and
                          the tooltip would otherwise be the only place
                          the reason lives. */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-disabled={role.isProtected || undefined}
                            className={
                              role.isProtected
                                ? "text-muted-foreground/50 hover:bg-transparent hover:text-muted-foreground/50"
                                : "text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
                            }
                            onClick={() => {
                              if (role.isProtected) {
                                toast.info(
                                  `${role.displayName} is a protected role and can’t be deleted.`,
                                );
                                return;
                              }
                              setDeleteTarget(role);
                            }}
                            aria-label={
                              role.isProtected
                                ? `Delete ${role.displayName} (protected — can’t be deleted)`
                                : `Delete ${role.displayName}`
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {role.isProtected
                            ? "Protected role — can’t be deleted"
                            : "Delete"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </li>
                </SortableItem>
              );
            })}
          </ul>
        </SortableContent>
      </Sortable>

      {/* The reorder bar's bleed tracks `PageContainer`'s gutter,
          `px-4 sm:px-6`. It said `md:` before, so between `sm` and `md`
          the bar sat 8px inside the page's own edge. It also wraps below
          `sm`: the message and both buttons on one line pushed the
          buttons off the right of a phone. */}
      {orderDirty ? (
        <div className="sticky bottom-0 mt-4 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <span className="text-sm text-muted-foreground">
            Order changed. Save to persist or discard to revert.
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDiscard}
              disabled={reorderMutation.isPending}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={reorderMutation.isPending}
            >
              {reorderMutation.isPending ? "Saving…" : "Save order"}
            </Button>
          </div>
        </div>
      ) : null}

      {editorTarget ? (
        <RoleEditorSheet
          roleId={editorTarget.roleId}
          roleName={editorTarget.roleName}
          open
          onOpenChange={(o) => {
            if (!o) {
              setEditorTarget(null);
            }
          }}
        />
      ) : null}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the role &ldquo;
              {deleteTarget?.displayName}&rdquo;? This will remove it from all{" "}
              {deleteTarget?.memberCount ?? 0} member(s) who have it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id, {
                    onSuccess: () => setDeleteTarget(null),
                  });
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
