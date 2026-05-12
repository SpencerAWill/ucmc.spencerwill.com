/**
 * Officer-facing tags-management dialog. Single Dialog that swaps
 * between a list pane and a form pane (matching the gear-types
 * dialog's pattern) so create/edit never opens a second modal on top
 * of the first.
 *
 * Delete still uses an AlertDialog because destructive confirmations
 * are conventional as their own modal; the form pane is part of the
 * primary workspace so it lives inside the same Dialog shell.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Edit, Lock, Plus, Trash2 } from "lucide-react";
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
import { Item, ItemActions, ItemContent } from "#/components/ui/item";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import { gearTagsQueryOptions } from "#/features/gear/api/queries";
import { useCreateGearTag } from "#/features/gear/api/use-create-gear-tag";
import { useDeleteGearTag } from "#/features/gear/api/use-delete-gear-tag";
import { useEditGearTag } from "#/features/gear/api/use-edit-gear-tag";
import type { GearTagSummary } from "#/features/gear/server/gear-fns";

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; tag: GearTagSummary };

export function GearTagsManageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [pendingDelete, setPendingDelete] = useState<GearTagSummary | null>(
    null,
  );
  const { data, isLoading } = useQuery(gearTagsQueryOptions());
  const deleteMutation = useDeleteGearTag();

  const onConfirmDelete = () => {
    if (!pendingDelete) return;
    deleteMutation.mutate(
      { publicId: pendingDelete.publicId },
      {
        onSuccess: () => {
          toast.success(`Tag #${pendingDelete.name} deleted`);
          setPendingDelete(null);
        },
        onError: () => toast.error("Couldn't delete the tag."),
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
                  aria-label="Back to tags"
                >
                  <ArrowLeft className="size-4" />
                </Button>
              ) : null}
              {mode.kind === "list"
                ? "Gear tags"
                : mode.kind === "create"
                  ? "New tag"
                  : `Edit #${mode.tag.name}`}
            </DialogTitle>
            <DialogDescription>
              Non-exclusive labels (e.g. <code>#outdoor</code>,{" "}
              <code>#winter</code>). Officers can mark a tag as
              <strong> Internal</strong> to keep it hidden from non-manager
              members.
            </DialogDescription>
          </DialogHeader>

          {mode.kind === "list" ? (
            <ListPane
              tags={data ?? []}
              isLoading={isLoading}
              onCreate={() => setMode({ kind: "create" })}
              onEdit={(tag) => setMode({ kind: "edit", tag })}
              onDelete={(tag) => setPendingDelete(tag)}
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
            <AlertDialogTitle>Delete #{pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the tag from every gear row that carries it. Gear itself
              is untouched.
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
  tags,
  isLoading,
  onCreate,
  onEdit,
  onDelete,
}: {
  tags: GearTagSummary[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (tag: GearTagSummary) => void;
  onDelete: (tag: GearTagSummary) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onCreate}>
          <Plus className="size-4" />
          New tag
        </Button>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tags.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              No tags yet. Create one with the button above.
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
          {tags.map((t) => (
            <li key={t.publicId}>
              <Item variant="outline" size="sm">
                <ItemContent>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="w-fit">
                      #{t.name}
                    </Badge>
                    {t.visibility === "internal" ? (
                      <Badge variant="secondary" className="gap-1">
                        <Lock className="size-3" />
                        Internal
                      </Badge>
                    ) : null}
                  </div>
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
  mode: { kind: "create" } | { kind: "edit"; tag: GearTagSummary };
  onDone: () => void;
}) {
  const isEdit = mode.kind === "edit";
  const [name, setName] = useState(isEdit ? mode.tag.name : "");
  const [visibility, setVisibility] = useState<"public" | "internal">(
    isEdit ? mode.tag.visibility : "public",
  );
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateGearTag();
  const editMutation = useEditGearTag();
  const pending = createMutation.isPending || editMutation.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isEdit) {
      editMutation.mutate(
        { publicId: mode.tag.publicId, name, visibility },
        {
          onSuccess: (result) => {
            if (result.ok) {
              toast.success(`Saved #${result.name}`);
              onDone();
              return;
            }
            setError(
              result.reason === "name_in_use"
                ? "Another tag already uses that name."
                : "Name can't be empty.",
            );
          },
          onError: () => setError("Couldn't save the tag."),
        },
      );
      return;
    }
    createMutation.mutate(
      { name, visibility },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Created #${result.name}`);
            onDone();
            return;
          }
          setError(
            result.reason === "name_in_use"
              ? "A tag with that name already exists."
              : "Name can't be empty.",
          );
        },
        onError: () => setError("Couldn't create the tag."),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4 border-0">
        <div className="space-y-1.5">
          <Label htmlFor="tag-name">Name</Label>
          <Input
            id="tag-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="outdoor"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Visibility</Label>
          <RadioGroup
            value={visibility}
            onValueChange={(v) => setVisibility(v as "public" | "internal")}
          >
            <div className="flex items-start gap-2 text-sm">
              <RadioGroupItem
                value="public"
                id="tag-vis-public"
                className="mt-0.5"
              />
              <Label htmlFor="tag-vis-public" className="font-normal">
                <span className="font-medium">Public</span>
                <span className="block text-xs text-muted-foreground">
                  Visible to anyone with gear:read.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <RadioGroupItem
                value="internal"
                id="tag-vis-internal"
                className="mt-0.5"
              />
              <Label htmlFor="tag-vis-internal" className="font-normal">
                <span className="font-medium">Internal</span>
                <span className="block text-xs text-muted-foreground">
                  Officers only. Hidden from gear card chips and the tag picker
                  for non-managers.
                </span>
              </Label>
            </div>
          </RadioGroup>
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
        <Button type="submit" disabled={pending}>
          {isEdit ? "Save" : "Create tag"}
        </Button>
      </DialogFooter>
    </form>
  );
}
