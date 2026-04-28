import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Pencil,
  Plus,
  Shield,
  Trash2,
} from "lucide-react";
import { Fragment, useState } from "react";
import { z } from "zod";

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
import { Card, CardContent, CardHeader } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import { Textarea } from "#/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { requirePermission } from "#/features/auth/guards";
import {
  permissionsQueryOptions,
  rolesDetailedQueryOptions,
} from "#/features/members/api/queries";
import { useCreateRole } from "#/features/members/api/use-create-role";
import { useDeleteRole } from "#/features/members/api/use-delete-role";
import { useSetRolePermissions } from "#/features/members/api/use-set-role-permissions";
import { useSwapRolePositions } from "#/features/members/api/use-swap-role-positions";
import type {
  PermissionSummary,
  RoleWithPermissions,
} from "#/features/members/server/rbac-fns";

export const Route = createFileRoute("/members/roles")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "roles:manage");
  },
  component: RolesPage,
});

// ── page ───────────────────────────────────────────────────────────────

function RolesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleWithPermissions | null>(
    null,
  );

  const { data: roles = [], isLoading: rolesLoading } = useQuery(
    rolesDetailedQueryOptions(),
  );
  const { data: permissions = [] } = useQuery(permissionsQueryOptions());

  const deleteMutation = useDeleteRole();
  const reorderMutation = useSwapRolePositions();

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roles</h1>
          <p className="text-sm text-muted-foreground">
            Manage roles and their permission grants.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" />
          <span className="hidden sm:inline">Create role</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      {/* Roles list — cards on mobile, table on desktop */}
      {rolesLoading ? (
        <div className="text-sm text-muted-foreground">Loading roles…</div>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="space-y-3 md:hidden">
            {roles.map((role, idx) => (
              <Card key={role.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <Shield className="size-4 text-muted-foreground" />
                    <Link
                      to="/members/roles/$roleId"
                      params={{ roleId: role.id }}
                      className="font-medium hover:underline"
                    >
                      {role.name}
                    </Link>
                    {role.isProtected ? (
                      <Badge variant="outline" className="text-xs">
                        protected
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={idx === 0 || reorderMutation.isPending}
                      onClick={() =>
                        reorderMutation.mutate({
                          roleId: role.id,
                          direction: "up",
                        })
                      }
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={
                        idx === roles.length - 1 || reorderMutation.isPending
                      }
                      onClick={() =>
                        reorderMutation.mutate({
                          roleId: role.id,
                          direction: "down",
                        })
                      }
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {role.description ? (
                    <p className="text-muted-foreground">{role.description}</p>
                  ) : null}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{role.memberCount} member(s)</span>
                    <span>
                      {role.name === "system_admin"
                        ? "All permissions"
                        : `${role.permissionIds.length} permission(s)`}
                    </span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        to="/members/roles/$roleId"
                        params={{ roleId: role.id }}
                      >
                        <Pencil className="mr-1 size-3" />
                        Edit
                      </Link>
                    </Button>
                    {!role.isProtected ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteTarget(role)}
                      >
                        <Trash2 className="mr-1 size-3" />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden rounded-md border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Members</TableHead>
                  <TableHead className="text-center">Permissions</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role, idx) => (
                  <TableRow key={role.id}>
                    <TableCell>
                      <div className="flex flex-col items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          disabled={idx === 0 || reorderMutation.isPending}
                          onClick={() =>
                            reorderMutation.mutate({
                              roleId: role.id,
                              direction: "up",
                            })
                          }
                        >
                          <ArrowUp className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          disabled={
                            idx === roles.length - 1 ||
                            reorderMutation.isPending
                          }
                          onClick={() =>
                            reorderMutation.mutate({
                              roleId: role.id,
                              direction: "down",
                            })
                          }
                        >
                          <ArrowDown className="size-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Shield className="size-4 text-muted-foreground" />
                        <Link
                          to="/members/roles/$roleId"
                          params={{ roleId: role.id }}
                          className="hover:underline"
                        >
                          {role.name}
                        </Link>
                        {role.isProtected ? (
                          <Badge variant="outline" className="text-xs">
                            protected
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-50 truncate text-sm text-muted-foreground">
                      {role.description ?? "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {role.memberCount}
                    </TableCell>
                    <TableCell className="text-center">
                      {role.name === "system_admin" ? (
                        <Badge variant="secondary">All</Badge>
                      ) : (
                        role.permissionIds.length
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" asChild>
                              <Link
                                to="/members/roles/$roleId"
                                params={{ roleId: role.id }}
                              >
                                <Pencil className="size-4" />
                              </Link>
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
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Permission matrix — accordion on mobile, table on desktop */}
      {permissions.length > 0 && roles.length > 0 ? (
        <div>
          <div className="md:hidden">
            <MobilePermissionAccordion
              roles={roles}
              permissions={permissions}
            />
          </div>
          <div className="hidden md:block">
            <PermissionMatrix roles={roles} permissions={permissions} />
          </div>
        </div>
      ) : null}

      {/* Create dialog */}
      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Delete confirmation */}
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
              {deleteTarget?.name}&rdquo;? This will remove it from all{" "}
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
    </div>
  );
}

// ── create role dialog ─────────────────────────────────────────────────

const roleNameSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .max(60, "At most 60 characters")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Lowercase letters, digits, and underscores only; must start with a letter",
  );

function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useCreateRole();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = roleNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    setError(null);
    mutation.mutate(
      {
        name: parsed.data,
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setName("");
          setDescription("");
          setError(null);
          onOpenChange(false);
        },
        onError: (err: Error) => {
          setError(err.message);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setError(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent onKeyDown={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>
              Add a new role. You can assign permissions to it after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                placeholder="e.g. trip_leader"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                maxLength={60}
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits, and underscores. Cannot be changed
                after creation.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-desc">Description (optional)</Label>
              <Textarea
                id="role-desc"
                placeholder="What this role is for…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
                rows={2}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── permission matrix ──────────────────────────────────────────────────

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

function PermissionMatrix({
  roles,
  permissions,
}: {
  roles: RoleWithPermissions[];
  permissions: PermissionSummary[];
}) {
  const grouped = groupPermissions(permissions);

  const setPermsMutation = useSetRolePermissions();

  function handleToggle(
    role: RoleWithPermissions,
    permId: string,
    checked: boolean,
  ) {
    const current = new Set(role.permissionIds);
    if (checked) {
      current.add(permId);
    } else {
      current.delete(permId);
    }
    setPermsMutation.mutate({
      roleId: role.id,
      permissionIds: Array.from(current),
    });
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">Permission matrix</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Toggle which permissions each role has. System admin always has all
        permissions.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 min-w-50 bg-background">
                Permission
              </TableHead>
              {roles.map((role) => (
                <TableHead key={role.id} className="text-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help whitespace-nowrap text-xs">
                        {role.name}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {role.description ?? role.name}
                    </TooltipContent>
                  </Tooltip>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from(grouped.entries()).map(([group, perms]) => (
              <Fragment key={group}>
                {/* Group separator row */}
                <TableRow>
                  <TableCell
                    colSpan={roles.length + 1}
                    className="bg-muted/50 py-1.5 text-xs font-medium capitalize text-muted-foreground"
                  >
                    {group}
                  </TableCell>
                </TableRow>
                {perms.map((perm) => (
                  <TableRow key={perm.id}>
                    <TableCell className="sticky left-0 z-10 bg-background">
                      <div>
                        <span className="text-sm font-medium">
                          {perm.name.split(":")[1] ?? perm.name}
                        </span>
                        {perm.description ? (
                          <p className="text-xs text-muted-foreground">
                            {perm.description}
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    {roles.map((role) => {
                      const isAdmin = role.name === "system_admin";
                      const granted = isAdmin
                        ? true
                        : role.permissionIds.includes(perm.id);
                      return (
                        <TableCell key={role.id} className="text-center">
                          <Checkbox
                            checked={granted}
                            disabled={isAdmin || setPermsMutation.isPending}
                            onCheckedChange={(checked) =>
                              handleToggle(role, perm.id, checked === true)
                            }
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── mobile permission accordion ────────────────────────────────────────

function MobilePermissionAccordion({
  roles,
  permissions,
}: {
  roles: RoleWithPermissions[];
  permissions: PermissionSummary[];
}) {
  const grouped = groupPermissions(permissions);

  const setPermsMutation = useSetRolePermissions();

  function handleToggle(
    role: RoleWithPermissions,
    permId: string,
    checked: boolean,
  ) {
    const current = new Set(role.permissionIds);
    if (checked) {
      current.add(permId);
    } else {
      current.delete(permId);
    }
    setPermsMutation.mutate({
      roleId: role.id,
      permissionIds: Array.from(current),
    });
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">Permissions</h2>
      <div className="space-y-2">
        {roles.map((role) => {
          const isAdmin = role.name === "system_admin";
          return (
            <Collapsible key={role.id}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50 [&[data-state=open]>svg]:rotate-180">
                <div className="flex items-center gap-2">
                  <Shield className="size-4 text-muted-foreground" />
                  {role.name}
                  {isAdmin ? (
                    <Badge variant="secondary" className="text-xs">
                      All
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {role.permissionIds.length} granted
                    </span>
                  )}
                </div>
                <ChevronDown className="size-4 transition-transform" />
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
                        <p className="mb-1 px-2 text-xs font-medium capitalize text-muted-foreground">
                          {group}
                        </p>
                        {perms.map((perm) => {
                          const granted = role.permissionIds.includes(perm.id);
                          return (
                            <label
                              key={perm.id}
                              className="flex items-start gap-3 rounded-md px-2 py-1.5"
                            >
                              <Checkbox
                                checked={granted}
                                disabled={setPermsMutation.isPending}
                                onCheckedChange={(checked) =>
                                  handleToggle(role, perm.id, checked === true)
                                }
                                className="mt-0.5"
                              />
                              <div className="min-w-0">
                                <span className="text-sm">
                                  {perm.name.split(":")[1] ?? perm.name}
                                </span>
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
    </div>
  );
}
