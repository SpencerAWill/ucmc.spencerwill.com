import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { Button } from "#/components/ui/button";
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
import {
  useCreateHonoraryMember,
  useDeleteHonoraryMember,
  useUpdateHonoraryMember,
} from "#/features/history/api/use-honorary-member-mutations";
import type { HonoraryEntry } from "#/features/history/server/history-fns";

interface FormState {
  mode: "create" | "edit";
  id?: number;
  name: string;
  sortOrder: string;
  notes: string;
}

function emptyForm(members: HonoraryEntry[]): FormState {
  // Default sortOrder to "next slot" so a fresh entry lands at the
  // end of the canonical list rather than mid-stream.
  const nextSort = members.length + 1;
  return {
    mode: "create",
    name: "",
    sortOrder: String(nextSort),
    notes: "",
  };
}

/**
 * `history:manage`-gated CRUD surface for the honorary-members list.
 * Same shape as the officer manager — inline form panel toggles
 * between hidden / create / edit modes; delete confirms via an
 * AlertDialog.
 */
export function ManageHonoraryMembersSheet({
  open,
  onOpenChange,
  members,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  members: HonoraryEntry[];
}) {
  const createMut = useCreateHonoraryMember();
  const updateMut = useUpdateHonoraryMember();
  const deleteMut = useDeleteHonoraryMember();

  const [form, setForm] = useState<FormState | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function startCreate() {
    setForm(emptyForm(members));
  }
  function startEdit(member: HonoraryEntry, sortOrder: number) {
    setForm({
      mode: "edit",
      id: member.id,
      name: member.name,
      sortOrder: String(sortOrder),
      notes: member.notes ?? "",
    });
  }

  async function submitForm() {
    if (!form) {
      return;
    }
    const sortOrder = Number.parseInt(form.sortOrder, 10);
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      toast.error("Sort order must be a non-negative integer.");
      return;
    }
    const name = form.name.trim();
    if (name.length === 0) {
      toast.error("Name is required.");
      return;
    }
    const notes = form.notes.trim().length > 0 ? form.notes.trim() : null;
    const payload = { name, sortOrder, notes };
    try {
      if (form.mode === "create") {
        await createMut.mutateAsync(payload);
        toast.success("Honorary member added.");
      } else if (form.id !== undefined) {
        await updateMut.mutateAsync({ id: form.id, ...payload });
        toast.success("Honorary member updated.");
      }
      setForm(null);
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the entry.",
      );
    }
  }

  async function confirmDelete() {
    if (deletingId === null) {
      return;
    }
    try {
      await deleteMut.mutateAsync({ id: deletingId });
      toast.success("Honorary member deleted.");
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete the entry.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>Manage honorary members</SheetTitle>
          <SheetDescription>
            Honorary membership is granted by majority vote of the voting
            membership per Constitution §3.4. Sort order controls display
            sequence — leave higher numbers for newer inductees to keep the
            canonical legacy ordering at the top.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {form === null ? (
            <Button type="button" size="sm" onClick={startCreate}>
              <Plus className="size-4" />
              Add honorary member
            </Button>
          ) : (
            <HonoraryFormPanel
              form={form}
              onChange={setForm}
              onSubmit={() => void submitForm()}
              onCancel={() => setForm(null)}
              submitting={submitting}
            />
          )}

          <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card/40 text-sm">
            {members.length === 0 ? (
              <li className="px-3 py-3 text-muted-foreground">
                No honorary members yet. Add one above.
              </li>
            ) : null}
            {members.map((member, idx) => {
              // members come back from the server already sorted by
              // sortOrder asc; the absolute slot number isn't part of
              // the API shape so we derive it here for the edit form.
              const sortOrder = idx + 1;
              return (
                <li
                  key={member.id}
                  className="flex items-center justify-between gap-2 px-3 py-1.5"
                >
                  <p className="truncate">{member.name}</p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${member.name}`}
                      onClick={() => startEdit(member, sortOrder)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${member.name}`}
                      onClick={() => setDeletingId(member.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <SheetFooter className="border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </SheetFooter>
      </SheetContent>

      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeletingId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this honorary member?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the entry permanently. You can re-add it later if
              needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function HonoraryFormPanel({
  form,
  onChange,
  onSubmit,
  onCancel,
  submitting,
}: {
  form: FormState;
  onChange: (next: FormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <form
      className="space-y-3 rounded-md border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSubmit();
      }}
    >
      <p className="text-sm font-medium">
        {form.mode === "create"
          ? "New honorary member"
          : "Edit honorary member"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="honorary-name">Name</Label>
          <Input
            id="honorary-name"
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            placeholder="Steve Must"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="honorary-sort-order">Sort order</Label>
          <Input
            id="honorary-sort-order"
            type="number"
            value={form.sortOrder}
            onChange={(e) => onChange({ ...form, sortOrder: e.target.value })}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="honorary-notes">Notes (optional)</Label>
          <Input
            id="honorary-notes"
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
