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
  useCreateHistoricalOfficer,
  useUpdateHistoricalOfficer,
} from "#/features/history/api/use-historical-officer-mutations";
import type { OfficerEntry } from "#/features/history/server/history-fns";

const SCHOOL_YEAR_RE = /^\d{4}-\d{2}$/;

/**
 * Seed data for opening the officer form dialog. `mode = "create"`
 * leaves `id` undefined; the parent can prefill `schoolYear` /
 * `startYear` so "Add" from inside a year card defaults to that year.
 * `mode = "edit"` carries the full officer row.
 */
export type OfficerFormSeed =
  | {
      mode: "create";
      schoolYear?: string;
      startYear?: number;
    }
  | {
      mode: "edit";
      officer: OfficerEntry;
      schoolYear: string;
      startYear: number;
    };

interface FormState {
  schoolYear: string;
  startYear: string;
  role: string;
  roleOrder: string;
  name: string;
  notes: string;
}

function seedToForm(seed: OfficerFormSeed): FormState {
  if (seed.mode === "edit") {
    return {
      schoolYear: seed.schoolYear,
      startYear: String(seed.startYear),
      role: seed.officer.role,
      roleOrder: String(seed.officer.roleOrder),
      name: seed.officer.name,
      notes: seed.officer.notes ?? "",
    };
  }
  return {
    schoolYear: seed.schoolYear ?? "",
    startYear: seed.startYear !== undefined ? String(seed.startYear) : "",
    role: "",
    roleOrder: "1",
    name: "",
    notes: "",
  };
}

/**
 * Create-or-edit dialog for a historical-officer row. Mounted at the
 * /history page level (not inside a manager sheet) so it can sit on
 * top of inline edit affordances directly on the year-card. Parent
 * controls visibility via the `seed` prop — non-null opens the
 * dialog; passing `null` (or onClose firing) closes it.
 */
export function OfficerFormDialog({
  seed,
  onClose,
}: {
  seed: OfficerFormSeed | null;
  onClose: () => void;
}) {
  const createMut = useCreateHistoricalOfficer();
  const updateMut = useUpdateHistoricalOfficer();
  const [form, setForm] = useState<FormState | null>(null);

  // Re-seed the form whenever the dialog opens / the seed changes —
  // otherwise edit-after-edit would keep showing the first row's
  // values.
  useEffect(() => {
    setForm(seed === null ? null : seedToForm(seed));
  }, [seed]);

  const submitting = createMut.isPending || updateMut.isPending;

  async function submitForm() {
    if (!form || !seed) {
      return;
    }
    if (!SCHOOL_YEAR_RE.test(form.schoolYear)) {
      toast.error("School year must look like 2026-27.");
      return;
    }
    const startYear = Number.parseInt(form.startYear, 10);
    const roleOrder = Number.parseInt(form.roleOrder, 10);
    if (!Number.isFinite(startYear) || startYear < 1900 || startYear > 2100) {
      toast.error("Start year must be a four-digit calendar year.");
      return;
    }
    if (!Number.isFinite(roleOrder)) {
      toast.error("Role order must be a non-negative integer.");
      return;
    }
    const role = form.role.trim();
    const name = form.name.trim();
    if (role.length === 0 || name.length === 0) {
      toast.error("Role and name are required.");
      return;
    }
    const notes = form.notes.trim().length > 0 ? form.notes.trim() : null;
    const payload = {
      schoolYear: form.schoolYear,
      startYear,
      role,
      roleOrder,
      name,
      notes,
    };
    try {
      if (seed.mode === "create") {
        await createMut.mutateAsync(payload);
        toast.success("Officer entry added.");
      } else {
        await updateMut.mutateAsync({ id: seed.officer.id, ...payload });
        toast.success("Officer entry updated.");
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
            {seed?.mode === "edit" ? "Edit officer entry" : "Add officer entry"}
          </DialogTitle>
          <DialogDescription>
            Free-form role text preserves historical positions ("Librarian,"
            "Gear Assistants"). Use commas to join co-holders ("Alice Smith, Bob
            Jones").
          </DialogDescription>
        </DialogHeader>
        {form !== null ? (
          <form
            id="officer-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitForm();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="officer-school-year">
                  School year (YYYY-YY)
                </Label>
                <Input
                  id="officer-school-year"
                  value={form.schoolYear}
                  onChange={(e) =>
                    setForm({ ...form, schoolYear: e.target.value })
                  }
                  placeholder="2026-27"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="officer-start-year">Start year</Label>
                <Input
                  id="officer-start-year"
                  type="number"
                  value={form.startYear}
                  onChange={(e) =>
                    setForm({ ...form, startYear: e.target.value })
                  }
                  placeholder="2026"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="officer-role">Role</Label>
                <Input
                  id="officer-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="President"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="officer-role-order">Role order</Label>
                <Input
                  id="officer-role-order"
                  type="number"
                  value={form.roleOrder}
                  onChange={(e) =>
                    setForm({ ...form, roleOrder: e.target.value })
                  }
                  placeholder="1"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="officer-name">
                  Name (comma-separated for co-holders)
                </Label>
                <Input
                  id="officer-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Alice Smith, Bob Jones"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="officer-notes">Notes (optional)</Label>
                <Input
                  id="officer-notes"
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
            form="officer-form"
            disabled={submitting || form === null}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
