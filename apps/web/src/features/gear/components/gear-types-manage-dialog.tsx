/**
 * Officer-facing types-management dialog. Replaces the standalone
 * `/gear/types` route — types CRUD is low-frequency enough that a
 * modal off the main gear page is the right surface.
 *
 * Two panes:
 *   - List view: every type with rename / delete affordances
 *   - Form view: create-new or edit-existing form
 *
 * Switching between them is local state; the dialog stays open across
 * pane changes so an officer can edit several types in one session
 * without re-opening.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Edit, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "#/components/ui/item";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { gearTypesQueryOptions } from "#/features/gear/api/queries";
import { useCreateGearType } from "#/features/gear/api/use-create-gear-type";
import { useDeleteGearType } from "#/features/gear/api/use-delete-gear-type";
import { useEditGearType } from "#/features/gear/api/use-edit-gear-type";
import type { GearTypeSummary } from "#/features/gear/server/gear-fns";

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; type: GearTypeSummary };

export function GearTypesManageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [pendingDelete, setPendingDelete] = useState<GearTypeSummary | null>(
    null,
  );
  const { data, isLoading } = useQuery(gearTypesQueryOptions());
  const deleteMutation = useDeleteGearType();

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    deleteMutation.mutate(
      { publicId: pendingDelete.publicId },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Type "${pendingDelete.name}" deleted`);
            setPendingDelete(null);
          } else {
            toast.error(
              "Can't delete — gear still references this type. Retire or move pieces first.",
            );
          }
        },
        onError: () => toast.error("Couldn't delete."),
      },
    );
  };

  // Reset back to the list pane on each dialog open/close cycle so
  // re-entering doesn't drop the user into a stale edit form.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setMode({ kind: "list" });
      setPendingDelete(null);
    }
    onOpenChange(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {mode.kind !== "list" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setMode({ kind: "list" })}
                  aria-label="Back to types"
                >
                  <ArrowLeft className="size-4" />
                </Button>
              ) : null}
              {mode.kind === "list"
                ? "Gear types"
                : mode.kind === "create"
                  ? "New type"
                  : `Edit ${mode.type.name}`}
            </DialogTitle>
            <DialogDescription>
              Types exclusively partition the inventory. Prefix is a UI hint for
              the suggested-code helper — it doesn&apos;t constrain what codes
              officers may assign.
            </DialogDescription>
          </DialogHeader>

          {mode.kind === "list" ? (
            <ListPane
              types={data ?? []}
              isLoading={isLoading}
              onCreate={() => setMode({ kind: "create" })}
              onEdit={(type) => setMode({ kind: "edit", type })}
              onDelete={(type) => setPendingDelete(type)}
            />
          ) : (
            <FormPane mode={mode} onDone={() => setMode({ kind: "list" })} />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete type &ldquo;{pendingDelete?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Blocked while any gear (active or retired) still references this
              type. Retire or move those pieces first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                onConfirmDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ListPane({
  types,
  isLoading,
  onCreate,
  onEdit,
  onDelete,
}: {
  types: GearTypeSummary[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (type: GearTypeSummary) => void;
  onDelete: (type: GearTypeSummary) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          New type
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : types.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              No types yet. Create one to start tracking gear.
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
          {types.map((t) => (
            <li key={t.publicId}>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {t.name}
                    {t.prefix ? (
                      <Badge variant="outline" className="font-mono">
                        {t.prefix}
                      </Badge>
                    ) : null}
                  </ItemTitle>
                  {t.description ? (
                    <ItemDescription>{t.description}</ItemDescription>
                  ) : null}
                </ItemContent>
                <ItemActions>
                  <Button variant="ghost" size="sm" onClick={() => onEdit(t)}>
                    <Edit className="size-4" />
                    <span className="sr-only">Edit</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(t)}>
                    <Trash2 className="size-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormPane({
  mode,
  onDone,
}: {
  mode: { kind: "create" } | { kind: "edit"; type: GearTypeSummary };
  onDone: () => void;
}) {
  const isEdit = mode.kind === "edit";
  const [name, setName] = useState(isEdit ? mode.type.name : "");
  const [prefix, setPrefix] = useState(isEdit ? (mode.type.prefix ?? "") : "");
  const [description, setDescription] = useState(
    isEdit ? (mode.type.description ?? "") : "",
  );
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateGearType();
  const editMutation = useEditGearType();
  const submitting = createMutation.isPending || editMutation.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("Name is required.");
      return;
    }
    const payload = {
      name: trimmedName,
      prefix: prefix.trim().length === 0 ? null : prefix.trim(),
      description: description.trim().length === 0 ? null : description.trim(),
    };
    if (isEdit) {
      editMutation.mutate(
        { publicId: mode.type.publicId, ...payload },
        {
          onSuccess: (result) => {
            if (result.ok) {
              toast.success("Type updated");
              onDone();
            } else {
              setError("Another type already uses that name.");
            }
          },
          onError: () => setError("Couldn't save."),
        },
      );
      return;
    }
    createMutation.mutate(payload, {
      onSuccess: (result) => {
        if (result.ok) {
          toast.success(`Type "${trimmedName}" created`);
          onDone();
        } else {
          setError("Another type already uses that name.");
        }
      },
      onError: () => setError("Couldn't save."),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={submitting} className="space-y-4 border-0">
        <div className="space-y-1.5">
          <Label htmlFor="type-name">Name</Label>
          <Input
            id="type-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Climbing Harness"
            maxLength={80}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type-prefix">Prefix (optional)</Label>
          <Input
            id="type-prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="CH"
            maxLength={8}
          />
          <p className="text-xs text-muted-foreground">
            UI hint only — officers can use any code they want.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type-description">Description</Label>
          <Textarea
            id="type-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What kinds of items belong in this category?"
            rows={3}
            maxLength={500}
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {isEdit ? "Save changes" : "Create type"}
        </Button>
      </DialogFooter>
    </form>
  );
}
