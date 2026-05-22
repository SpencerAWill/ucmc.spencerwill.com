import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { Textarea } from "#/components/ui/textarea";
import {
  useCreateHonoraryMember,
  useUpdateHonoraryMember,
} from "#/features/history/api/use-honorary-member-mutations";
import type { HonoraryEntry } from "#/features/history/server/history-fns";

/**
 * Seed for opening the honorary-member dialog. Sort order is set
 * automatically — at create time we land the entry at the end of the
 * canonical list (parent passes `defaultSortOrder`); at edit time we
 * preserve the existing sortOrder unchanged (DnD is the only way to
 * reorder).
 */
export type HonoraryFormSeed =
  | {
      mode: "create";
      defaultSortOrder: number;
    }
  | {
      mode: "edit";
      member: HonoraryEntry;
      sortOrder: number;
    };

interface FormState {
  name: string;
  notes: string;
}

function seedToForm(seed: HonoraryFormSeed): FormState {
  if (seed.mode === "edit") {
    return {
      name: seed.member.name,
      notes: seed.member.notes ?? "",
    };
  }
  return {
    name: "",
    notes: "",
  };
}

export function HonoraryFormDialog({
  seed,
  onClose,
}: {
  seed: HonoraryFormSeed | null;
  onClose: () => void;
}) {
  const createMut = useCreateHonoraryMember();
  const updateMut = useUpdateHonoraryMember();
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    setForm(seed === null ? null : seedToForm(seed));
  }, [seed]);

  const submitting = createMut.isPending || updateMut.isPending;

  async function submitForm() {
    if (!form || !seed) {
      return;
    }
    const name = form.name.trim();
    if (name.length === 0) {
      toast.error("Name is required.");
      return;
    }
    const notes = form.notes.trim().length > 0 ? form.notes.trim() : null;
    try {
      if (seed.mode === "create") {
        // New entries land at the end of the list; existing sort_order
        // for the rest is left alone, and DnD reorders later.
        await createMut.mutateAsync({
          name,
          sortOrder: seed.defaultSortOrder,
          notes,
        });
        toast.success("Honorary member added.");
      } else {
        // Edits preserve the existing sort_order — DnD is the only way
        // to reorder, so the dialog has no slot for it.
        await updateMut.mutateAsync({
          id: seed.member.id,
          name,
          sortOrder: seed.sortOrder,
          notes,
        });
        toast.success("Honorary member updated.");
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the entry.",
      );
    }
  }

  return (
    <Dialog
      open={seed !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {seed?.mode === "edit"
              ? "Edit honorary member"
              : "Add honorary member"}
          </DialogTitle>
          <DialogDescription>
            New entries land at the end of the list. To change ordering, drag
            the handle on each row after saving.
          </DialogDescription>
        </DialogHeader>
        {form !== null ? (
          <form
            id="honorary-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitForm();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="honorary-name">Name</Label>
              <Input
                id="honorary-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Steve Must"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="honorary-notes">Notes (optional)</Label>
              <Textarea
                id="honorary-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Context: inducted year, distinguished contributions, etc."
                rows={3}
                maxLength={500}
              />
            </div>
          </form>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="honorary-form"
            disabled={submitting || form === null}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
