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
import {
  useCreateHonoraryMember,
  useUpdateHonoraryMember,
} from "#/features/history/api/use-honorary-member-mutations";
import type { HonoraryEntry } from "#/features/history/server/history-fns";

/**
 * Seed for opening the honorary-member dialog. For create mode the
 * parent may pass `defaultSortOrder` so the form defaults to the
 * "next slot" past the current count.
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
  sortOrder: string;
  notes: string;
}

function seedToForm(seed: HonoraryFormSeed): FormState {
  if (seed.mode === "edit") {
    return {
      name: seed.member.name,
      sortOrder: String(seed.sortOrder),
      notes: seed.member.notes ?? "",
    };
  }
  return {
    name: "",
    sortOrder: String(seed.defaultSortOrder),
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
      if (seed.mode === "create") {
        await createMut.mutateAsync(payload);
        toast.success("Honorary member added.");
      } else {
        await updateMut.mutateAsync({ id: seed.member.id, ...payload });
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
            Sort order controls display sequence. The list renders in ascending
            order — pick a higher number to push newer inductees toward the end.
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="honorary-name">Name</Label>
                <Input
                  id="honorary-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Steve Must"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="honorary-sort-order">Sort order</Label>
                <Input
                  id="honorary-sort-order"
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm({ ...form, sortOrder: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="honorary-notes">Notes (optional)</Label>
                <Input
                  id="honorary-notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
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
