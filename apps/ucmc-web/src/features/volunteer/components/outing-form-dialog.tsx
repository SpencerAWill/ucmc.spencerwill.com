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
  useCreateEvent,
  useUpdateEvent,
} from "#/features/volunteer/api/use-event-mutations";
import {
  fromLocalInputValue,
  toLocalInputValue,
} from "#/features/volunteer/lib/local-datetime";
import { VOLUNTEER_LIMITS } from "#/features/volunteer/server/volunteer-schemas";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";

export type OutingFormSeed =
  | { mode: "create" }
  | { mode: "edit"; outing: VolunteerEventEntry };

interface FormState {
  title: string;
  partnerOrg: string;
  location: string;
  startsAt: string;
  endsAt: string;
  description: string;
  signupUrl: string;
  volunteersCount: string;
  serviceHours: string;
  albumTag: string;
}

const EMPTY: FormState = {
  title: "",
  partnerOrg: "",
  location: "",
  startsAt: "",
  endsAt: "",
  description: "",
  signupUrl: "",
  volunteersCount: "",
  serviceHours: "",
  albumTag: "",
};

function seedToForm(seed: OutingFormSeed): FormState {
  if (seed.mode === "create") {
    return EMPTY;
  }
  const { outing } = seed;
  return {
    title: outing.title,
    partnerOrg: outing.partnerOrg ?? "",
    location: outing.location ?? "",
    startsAt: toLocalInputValue(outing.startsAtMs),
    endsAt: outing.endsAtMs === null ? "" : toLocalInputValue(outing.endsAtMs),
    description: outing.description ?? "",
    signupUrl: outing.signupUrl ?? "",
    volunteersCount:
      outing.volunteersCount === null ? "" : String(outing.volunteersCount),
    serviceHours:
      outing.serviceHours === null ? "" : String(outing.serviceHours),
    albumTag: outing.albumTag ?? "",
  };
}

/** Blank means absent, matching the nullable columns behind each field. */
function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function OutingFormDialog({
  seed,
  onClose,
}: {
  seed: OutingFormSeed | null;
  onClose: () => void;
}) {
  const createMut = useCreateEvent();
  const updateMut = useUpdateEvent();
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
    if (title.length === 0) {
      toast.error("A name is required.");
      return;
    }
    const startsAtMs = fromLocalInputValue(form.startsAt);
    if (startsAtMs === null) {
      toast.error("A start date and time are required.");
      return;
    }
    const endsAtMs = fromLocalInputValue(form.endsAt);
    if (endsAtMs !== null && endsAtMs < startsAtMs) {
      toast.error("The end time can't be before the start time.");
      return;
    }
    const payload = {
      title,
      partnerOrg: nullable(form.partnerOrg),
      location: nullable(form.location),
      startsAtMs,
      endsAtMs,
      description: nullable(form.description),
      signupUrl: nullable(form.signupUrl),
      volunteersCount: nullableInt(form.volunteersCount),
      serviceHours: nullableInt(form.serviceHours),
      albumTag: nullable(form.albumTag),
    };
    try {
      if (seed.mode === "create") {
        await createMut.mutateAsync(payload);
        toast.success("Outing added.");
      } else {
        await updateMut.mutateAsync({ id: seed.outing.id, ...payload });
        toast.success("Outing updated.");
      }
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save the outing.",
      );
    }
  }

  function field(key: keyof FormState) {
    return {
      value: form?.[key] ?? "",
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => {
        setForm((prev) =>
          prev === null ? prev : { ...prev, [key]: e.target.value },
        );
      },
    };
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {seed?.mode === "edit" ? "Edit outing" : "Add outing"}
          </DialogTitle>
          <DialogDescription>
            One dated trip. Outings from today onward show under “Coming up”;
            once the date passes, the same entry moves to the service record on
            its own — there's nothing to switch over.
          </DialogDescription>
        </DialogHeader>
        {form !== null ? (
          <form
            id="outing-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void submitForm();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="outing-title">Name</Label>
              <Input
                id="outing-title"
                {...field("title")}
                placeholder="Red River Gorge trail day"
                maxLength={VOLUNTEER_LIMITS.eventTitle.max}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="outing-org">Partner organization</Label>
                <Input
                  id="outing-org"
                  {...field("partnerOrg")}
                  placeholder="RRGCC"
                  maxLength={VOLUNTEER_LIMITS.partnerOrg.max}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="outing-location">Location</Label>
                <Input
                  id="outing-location"
                  {...field("location")}
                  placeholder="Slade, KY"
                  maxLength={VOLUNTEER_LIMITS.location.max}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="outing-starts">Starts</Label>
                <Input
                  id="outing-starts"
                  type="datetime-local"
                  {...field("startsAt")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="outing-ends">Ends (optional)</Label>
                <Input
                  id="outing-ends"
                  type="datetime-local"
                  {...field("endsAt")}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="outing-description">Description</Label>
              <Textarea
                id="outing-description"
                {...field("description")}
                placeholder="What the work involves, what to bring, where to meet."
                rows={3}
                maxLength={VOLUNTEER_LIMITS.description.max}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="outing-signup">Sign-up link (optional)</Label>
              <Input
                id="outing-signup"
                type="url"
                {...field("signupUrl")}
                placeholder="https://partner.org/register"
              />
              <p className="text-xs text-muted-foreground">
                The partner's own registration form. Leave blank and the Join
                button opens an email to the club instead.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="outing-volunteers">Volunteers</Label>
                <Input
                  id="outing-volunteers"
                  type="number"
                  min={0}
                  max={VOLUNTEER_LIMITS.volunteersCount.max}
                  {...field("volunteersCount")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="outing-hours">Service hours</Label>
                <Input
                  id="outing-hours"
                  type="number"
                  min={0}
                  max={VOLUNTEER_LIMITS.serviceHours.max}
                  {...field("serviceHours")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="outing-tag">Album tag</Label>
                <Input
                  id="outing-tag"
                  {...field("albumTag")}
                  placeholder="Trail Day 2026"
                  maxLength={80}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Volunteers and hours are filled in after the outing — leave them
              blank until then. Hours are the person-hours total (four hours ×
              twelve people is 48). The album tag links this outing to photos
              already in the Album.
            </p>
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
            form="outing-form"
            disabled={submitting || form === null}
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
