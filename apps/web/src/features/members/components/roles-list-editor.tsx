import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GripVertical, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { Textarea } from "#/components/ui/textarea";
import { rolesDetailedQueryOptions } from "#/features/members/api/queries";
import { useCreateRole } from "#/features/members/api/use-create-role";
import { useDeleteRole } from "#/features/members/api/use-delete-role";
import { useReorderRoles } from "#/features/members/api/use-reorder-roles";
import type { RoleWithPermissions } from "#/features/members/server/rbac-fns";

export function RolesListEditor() {
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleWithPermissions | null>(
    null,
  );

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    setOrder((prev) => {
      const oldIdx = prev.indexOf(active.id as string);
      const newIdx = prev.indexOf(over.id as string);
      if (oldIdx === -1 || newIdx === -1) {
        return prev;
      }
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

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
      <div className="flex items-center justify-between pb-4">
        <p className="text-sm text-muted-foreground">
          Drag to reorder. Hover a name to see its description.
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" />
          <span className="hidden sm:inline">Create role</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ul className="divide-y rounded-md border">
            {order.map((id) => {
              const role = rolesById.get(id);
              if (!role) {
                return null;
              }
              return (
                <SortableRoleRow
                  key={id}
                  role={role}
                  onDelete={() => setDeleteTarget(role)}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>

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

      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />

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
    </>
  );
}

function SortableRoleRow({
  role,
  onDelete,
}: {
  role: RoleWithPermissions;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: role.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 ${
        isDragging ? "bg-muted shadow-md" : "bg-background"
      }`}
    >
      <button
        type="button"
        className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
        aria-label={`Drag ${role.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <Shield className="size-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/members/roles/$roleId"
                params={{ roleId: role.id }}
                className="truncate font-medium hover:underline"
              >
                {role.name}
              </Link>
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
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground sm:flex">
        <span>{role.memberCount} member(s)</span>
        <span>
          {role.name === "system_admin"
            ? "All perms"
            : `${role.permissionIds.length} perm(s)`}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" asChild>
              <Link
                to="/members/roles/$roleId"
                params={{ roleId: role.id }}
                aria-label={`Edit ${role.name}`}
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
                onClick={onDelete}
                aria-label={`Delete ${role.name}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </li>
  );
}

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
