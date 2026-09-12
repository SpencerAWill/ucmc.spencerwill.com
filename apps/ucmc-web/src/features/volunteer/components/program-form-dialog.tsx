import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CuratedIcon } from "#/components/curated-icon/curated-icon";
import { isCuratedIcon } from "#/components/curated-icon/icon-names";
import type { CuratedIconName } from "#/components/curated-icon/icon-names";
import { IconPicker } from "#/components/curated-icon/icon-picker";
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
  useCreateOpportunity,
  useUpdateOpportunity,
} from "#/features/volunteer/api/use-opportunity-mutations";
import { VOLUNTEER_LIMITS } from "#/features/volunteer/server/volunteer-schemas";
import type { VolunteerOpportunityEntry } from "#/features/volunteer/server/volunteer-fns";

export type ProgramFormSeed =
  | { mode: "create" }
  | { mode: "edit"; program: VolunteerOpportunityEntry };

interface FormState {
  icon: CuratedIconName;
  title: string;
  blurb: string;
}

const DEFAULT_ICON: CuratedIconName = "HandHeart";

function seedToForm(seed: ProgramFormSeed): FormState {
  if (seed.mode === "edit") {
    return {
      // A stored name that has since left the whitelist falls back to
      // the default rather than putting an unselectable value into the
      // picker, which would render an empty trigger.
      icon: isCuratedIcon(seed.program.icon) ? seed.program.icon : DEFAULT_ICON,
      title: seed.program.title,
      blurb: seed.program.blurb,
    };
  }
  return { icon: DEFAULT_ICON, title: "", blurb: "" };
}

export function ProgramFormDialog({
  seed,
  onClose,
}: {
  seed: ProgramFormSeed | null;
  onClose: () => void;
}) {
  const createMut = useCreateOpportunity();
  const updateMut = useUpdateOpportunity();
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    setForm(seed === null ? null : seedToForm(seed));
  }, [seed]);

  const submitting = createMut.isPending || updateMut.isPending;

  async function submitForm() {
    if (!form || !seed) {
      return;
    }
    const title = form.title.trim();
    const blurb = form.blurb.trim();
    if (title.length === 0 || blurb.length === 0) {
      toast.error("A name and a short description are both required.");
      return;
    }
    try {
      if (seed.mode === "create") {
        await createMut.mutateAsync({ icon: form.icon, title, blurb });
        toast.success("Program added.");
      } else {
        await updateMut.mutateAsync({
          id: seed.program.id,
          icon: form.icon,
          title,
          blurb,
        });
        toast.success("Program updated.");
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the program.",
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
              ? "Edit volunteer program"
              : "Add volunteer program"}
          </DialogTitle>
          <DialogDescription>
            A kind of service the club does regularly — not a specific date. New
            programs land at the end of the list; drag the handle on a row to
            reorder.
          </DialogDescription>
        </DialogHeader>
        {form !== null ? (
          <form
            id="program-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitForm();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="program-icon">Icon</Label>
              <div className="flex items-center gap-3">
                <CuratedIcon
                  name={form.icon}
                  className="size-6 shrink-0 text-primary"
                />
                <div className="min-w-0 flex-1">
                  <IconPicker
                    value={form.icon}
                    onChange={(icon) => setForm({ ...form, icon })}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="program-title">Name</Label>
              <Input
                id="program-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Trail work"
                maxLength={VOLUNTEER_LIMITS.opportunityTitle.max}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="program-blurb">Short description</Label>
              <Textarea
                id="program-blurb"
                value={form.blurb}
                onChange={(e) => setForm({ ...form, blurb: e.target.value })}
                placeholder="Cutting and clearing approach trails with the local trail crew."
                rows={3}
                maxLength={VOLUNTEER_LIMITS.opportunityBlurb.max}
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
            form="program-form"
            disabled={submitting || form === null}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
