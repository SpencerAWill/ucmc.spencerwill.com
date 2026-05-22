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
  useCreateHistoricalOfficer,
  useDeleteHistoricalOfficer,
  useUpdateHistoricalOfficer,
} from "#/features/history/api/use-historical-officer-mutations";
import type { OfficerYearGroup } from "#/features/history/server/history-fns";

const SCHOOL_YEAR_RE = /^\d{4}-\d{2}$/;

interface FormState {
  mode: "create" | "edit";
  id?: number;
  schoolYear: string;
  startYear: string;
  role: string;
  roleOrder: string;
  name: string;
  notes: string;
}

function emptyForm(): FormState {
  return {
    mode: "create",
    schoolYear: "",
    startYear: "",
    role: "",
    roleOrder: "1",
    name: "",
    notes: "",
  };
}

/**
 * `history:manage`-gated CRUD surface for the past-officer archive.
 * Lists every year-block flat; clicking Edit on a row populates the
 * inline form, Save/Cancel returns to the list. Delete confirms via
 * an AlertDialog before firing the mutation. Co-holders (the legacy
 * "Alice, Bob" or "Alice / Bob" convention) are edited as the full
 * combined string — splitting them into separate rows is out of
 * scope for this UI.
 */
export function ManageOfficersSheet({
  open,
  onOpenChange,
  groups,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  groups: OfficerYearGroup[];
}) {
  const createMut = useCreateHistoricalOfficer();
  const updateMut = useUpdateHistoricalOfficer();
  const deleteMut = useDeleteHistoricalOfficer();

  const [form, setForm] = useState<FormState | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function startCreate() {
    setForm(emptyForm());
  }
  function startEdit(group: OfficerYearGroup, id: number) {
    const officer = group.officers.find((o) => o.id === id);
    if (!officer) {
      return;
    }
    setForm({
      mode: "edit",
      id,
      schoolYear: group.schoolYear,
      startYear: String(group.startYear),
      role: officer.role,
      roleOrder: String(officer.roleOrder),
      name: officer.name,
      notes: officer.notes ?? "",
    });
  }

  async function submitForm() {
    if (!form) {
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
      if (form.mode === "create") {
        await createMut.mutateAsync(payload);
        toast.success("Officer entry added.");
      } else if (form.id !== undefined) {
        await updateMut.mutateAsync({ id: form.id, ...payload });
        toast.success("Officer entry updated.");
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
      toast.success("Officer entry deleted.");
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
          <SheetTitle>Manage past officers</SheetTitle>
          <SheetDescription>
            Add, edit, or remove year-by-year exec board entries. Roles are
            free-form so historical positions like "Librarian" or "Gear
            Assistants" can be preserved as they appeared in their era.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {form === null ? (
            <Button type="button" size="sm" onClick={startCreate}>
              <Plus className="size-4" />
              Add officer entry
            </Button>
          ) : (
            <OfficerFormPanel
              form={form}
              onChange={setForm}
              onSubmit={() => void submitForm()}
              onCancel={() => setForm(null)}
              submitting={submitting}
            />
          )}

          <div className="space-y-4">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No officer entries yet. Add one above.
              </p>
            ) : null}
            {groups.map((group) => (
              <article
                key={group.schoolYear}
                className="space-y-2 rounded-md border border-border/60 bg-card/40 p-3"
              >
                <h3 className="text-sm font-semibold tracking-tight">
                  {group.schoolYear}
                </h3>
                <ul className="divide-y divide-border/60 text-sm">
                  {group.officers.map((officer) => (
                    <li
                      key={officer.id}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-muted-foreground">
                          {officer.role}
                        </p>
                        <p className="truncate">{officer.name}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${officer.role} (${group.schoolYear})`}
                          onClick={() => startEdit(group, officer.id)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${officer.role} (${group.schoolYear})`}
                          onClick={() => setDeletingId(officer.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
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
            <AlertDialogTitle>Delete this officer entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the historical record permanently. You can re-add it
              later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Stop the default close-on-click; the mutation handler
                // closes the dialog via setDeletingId(null).
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

function OfficerFormPanel({
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
        {form.mode === "create" ? "New officer entry" : "Edit officer entry"}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="officer-school-year">School year (YYYY-YY)</Label>
          <Input
            id="officer-school-year"
            value={form.schoolYear}
            onChange={(e) => onChange({ ...form, schoolYear: e.target.value })}
            placeholder="2026-27"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="officer-start-year">Start year</Label>
          <Input
            id="officer-start-year"
            type="number"
            value={form.startYear}
            onChange={(e) => onChange({ ...form, startYear: e.target.value })}
            placeholder="2026"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="officer-role">Role</Label>
          <Input
            id="officer-role"
            value={form.role}
            onChange={(e) => onChange({ ...form, role: e.target.value })}
            placeholder="President"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="officer-role-order">Role order</Label>
          <Input
            id="officer-role-order"
            type="number"
            value={form.roleOrder}
            onChange={(e) => onChange({ ...form, roleOrder: e.target.value })}
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
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            placeholder="Alice Smith, Bob Jones"
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="officer-notes">Notes (optional)</Label>
          <Input
            id="officer-notes"
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
