/**
 * Officer-facing tags-management dialog. Replaces the standalone
 * `/gear/tags` route. Tag creation happens inline from the gear edit
 * sheet's multiselect; this dialog is for renaming or pruning the
 * existing label vocabulary.
 */
import { useQuery } from "@tanstack/react-query";
import { Edit, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { gearTagsQueryOptions } from "#/features/gear/api/queries";
import { useDeleteGearTag } from "#/features/gear/api/use-delete-gear-tag";
import { useEditGearTag } from "#/features/gear/api/use-edit-gear-tag";
import type { GearTagSummary } from "#/features/gear/server/gear-fns";

export function GearTagsManageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useQuery(gearTagsQueryOptions());
  const [renaming, setRenaming] = useState<GearTagSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GearTagSummary | null>(
    null,
  );
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

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setRenaming(null);
      setPendingDelete(null);
    }
    onOpenChange(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gear tags</DialogTitle>
            <DialogDescription>
              Non-exclusive labels (e.g. <code>#outdoor</code>,{" "}
              <code>#winter</code>). Create tags inline from the gear edit sheet
              — this dialog is for renaming or pruning the existing label set.
              Deleting a tag removes it from every piece that carries it.
            </DialogDescription>
          </DialogHeader>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (data ?? []).length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>
                  No tags yet. Create one from the gear edit sheet.
                </EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
              {(data ?? []).map((t) => (
                <li key={t.publicId}>
                  <Item variant="outline" size="sm">
                    <ItemContent>
                      <Badge variant="outline" className="w-fit">
                        #{t.name}
                      </Badge>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRenaming(t)}
                      >
                        <Edit className="size-4" />
                        <span className="sr-only">Rename</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(t)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </ItemActions>
                  </Item>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <RenameTagDialog
        tag={renaming}
        onOpenChange={(o) => {
          if (!o) setRenaming(null);
        }}
      />

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

function RenameTagDialog({
  tag,
  onOpenChange,
}: {
  tag: GearTagSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editMutation = useEditGearTag();
  const open = tag !== null;

  useEffect(() => {
    if (tag) {
      setName(tag.name);
      setError(null);
    }
  }, [tag]);

  const onSubmit = () => {
    if (!tag) return;
    setError(null);
    editMutation.mutate(
      { publicId: tag.publicId, name },
      {
        onSuccess: (result) => {
          if (result.ok) {
            toast.success(`Renamed to #${result.name}`);
            setName("");
            onOpenChange(false);
            return;
          }
          if (result.reason === "name_in_use") {
            setError("Another tag already uses that name.");
          } else {
            setError("Name can't be empty.");
          }
        },
        onError: () => setError("Couldn't rename the tag."),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setName("");
          setError(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename #{tag?.name}</DialogTitle>
          <DialogDescription>
            Names normalize to lowercase-dash-case on save (e.g.{" "}
            <code>Outdoor Use → outdoor-use</code>).
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="rename-tag">New name</Label>
            <Input
              id="rename-tag"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              disabled={editMutation.isPending}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={editMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={editMutation.isPending}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
