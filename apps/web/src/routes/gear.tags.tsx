import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Edit, Trash2 } from "lucide-react";
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
import { Card, CardContent } from "#/components/ui/card";
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
import { Label } from "#/components/ui/label";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePermission } from "#/features/auth/guards";
import { gearTagsQueryOptions } from "#/features/gear/api/queries";
import { useDeleteGearTag } from "#/features/gear/api/use-delete-gear-tag";
import { useEditGearTag } from "#/features/gear/api/use-edit-gear-tag";
import type { GearTagSummary } from "#/features/gear/server/gear-fns";

export const Route = createFileRoute("/gear/tags")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "gear:manage");
  },
  component: GearTagsPage,
});

function GearTagsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("gear:manage");
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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/gear">
            <ArrowLeft className="size-4" />
            Back to gear
          </Link>
        </Button>
      </div>
      <header>
        <h1 className="text-xl font-semibold">Gear tags</h1>
        <p className="text-sm text-muted-foreground">
          Non-exclusive labels attached to gear (e.g. <code>#outdoor</code>,{" "}
          <code>#winter</code>). Create tags inline from the gear edit sheet —
          this page is for renaming or pruning existing labels. Deleting a tag
          removes it from every piece that carries it.
        </p>
      </header>
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
        <ul className="space-y-2">
          {(data ?? []).map((t) => (
            <li key={t.publicId}>
              <Card>
                <CardContent className="flex items-center justify-between gap-2 py-3">
                  <Badge variant="outline">#{t.name}</Badge>
                  {canManage ? (
                    <div className="flex items-center gap-1">
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
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <RenameDialog
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
              This removes the tag from every gear row that carries it. Gear
              itself is untouched.
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
    </div>
  );
}

function RenameDialog({
  tag,
  onOpenChange,
}: {
  tag: GearTagSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const editMutation = useEditGearTag();

  // Sync the input value with the tag being renamed each time the dialog
  // opens. The effect resets the field whenever the target tag changes.
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
            Names are normalized to lowercase-dash-case on save (e.g.
            <code> Outdoor Use → outdoor-use</code>).
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
