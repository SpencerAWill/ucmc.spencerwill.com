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

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate font-medium">
                              {role.displayName}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            {role.description ?? "No description."}
                          </TooltipContent>
                        </Tooltip>
                        {role.isProtected ? (
                          <Badge variant="outline" className="text-xs">
                            protected
                          </Badge>
                        ) : null}
                        {role.isOfficer ? (
                          <Badge
                            variant="secondary"
                            className="text-xs"
                            title="Surfaces on the public home page"
                          >
                            <Star className="mr-1 size-3" />
                            officer
                          </Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {role.name}
                      </p>
                    </div>

                    {/* Counts as icon + number badges rather than
                        "7 member(s) / 11 perm(s)" prose: at a glance the
                        list is a comparison between roles, and two
                        narrow tabular-nums badges scan down the column
                        in a way wrapped prose doesn't. Narrow enough to
                        survive on mobile, where the prose was hidden
                        outright. The tooltip carries the wording; the
                        aria-label carries it for screen readers, which
                        don't reach a tooltip on a non-focusable badge. */}
                    <div className="flex shrink-0 items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="secondary"
                            className="gap-1 px-1.5 tabular-nums"
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
                      {!role.isProtected ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteTarget(role)}
                              aria-label={`Delete ${role.displayName}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  </li>
                </SortableItem>
              );
            })}
          </ul>
        </SortableContent>
      </Sortable>

      {orderDirty ? (
        <div className="sticky bottom-0 mt-4 -mx-4 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
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
