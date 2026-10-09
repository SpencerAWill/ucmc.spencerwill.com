import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
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
import { NativeSelect } from "#/components/ui/native-select";
import { Textarea } from "#/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import type { EventKind, EventVisibility } from "#/../drizzle/schema";
import {
  useCreateEvent,
  useUpdateEvent,
} from "#/features/calendar/api/use-event-mutations";
import {
  clubDateOf,
  clubInputFromInstant,
  instantFromClubInput,
} from "#/features/calendar/lib/calendar-window";
import {
  EVENT_KIND_LABEL,
  EVENT_VISIBILITY_LABEL,
} from "#/features/calendar/lib/event-display";
import {
  EMPTY_RECURRENCE,
  buildRrule,
  describeRecurrence,
  parseRruleToForm,
} from "#/features/calendar/lib/recurrence-form";
import type { RecurrenceFormState } from "#/features/calendar/lib/recurrence-form";
import { WEEKDAYS } from "#/server/events/recurrence";
import type { Weekday } from "#/server/events/recurrence";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";
import { EVENT_LIMITS } from "#/features/calendar/server/event-schemas";

export type EventFormSeed =
  | { mode: "create"; date: Temporal.PlainDate }
  | { mode: "edit"; occurrence: CalendarOccurrence; rrule: string | null };

interface FormState {
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  kind: EventKind;
  visibility: EventVisibility;
  recurrence: RecurrenceFormState;
}

const KINDS: readonly EventKind[] = [
  "meeting",
  "trip",
  "social",
  "exec",
  "other",
];
const VISIBILITIES: readonly EventVisibility[] = [
  "public",
  "members",
  "officers",
];

const WEEKDAY_SHORT: Record<Weekday, string> = {
  MO: "M",
  TU: "T",
  WE: "W",
  TH: "T",
  FR: "F",
  SA: "S",
  SU: "S",
};

function seedToForm(seed: EventFormSeed): FormState {
  if (seed.mode === "edit") {
    const { occurrence } = seed;
    return {
      title: occurrence.title,
      description: occurrence.description ?? "",
      location: occurrence.location ?? "",
      startsAt: clubInputFromInstant(occurrence.startsAt),
      endsAt:
        occurrence.endsAt === null
          ? ""
          : clubInputFromInstant(occurrence.endsAt),
      allDay: occurrence.allDay,
      kind: occurrence.kind,
      visibility: occurrence.visibility,
      recurrence: parseRruleToForm(seed.rrule),
    };
  }
  // A new event defaults to 18:00–19:00 on the day the officer had
  // selected. The club's own meeting hour, and one less field to touch
  // for the thing they most often add.
  const start = seed.date.toPlainDateTime({ hour: 18 });
  return {
    title: "",
    description: "",
    location: "",
    startsAt: start.toString({ smallestUnit: "minute" }),
    endsAt: start.add({ hours: 1 }).toString({ smallestUnit: "minute" }),
    allDay: false,
    kind: "meeting",
    visibility: "members",
    recurrence: EMPTY_RECURRENCE,
  };
}

/**
 * Create or edit one event.
 *
 * **Edits apply to the whole series.** A recurring event's single
 * occurrence is changed from the detail sheet's "skip / move this one"
 * affordance instead, which writes an `event_exceptions` row. Keeping
 * those two operations in separate places is the point: an officer who
 * opens "edit" on the May 13 meeting and changes the time has almost
 * always meant *every* Wednesday, and a dialog that silently did one or
 * the other depending on a radio nobody read is how a semester's
 * schedule moves by accident.
 */
export function EventFormDialog({
  seed,
  onOpenChange,
}: {
  seed: EventFormSeed | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    seed
      ? seedToForm(seed)
      : seedToForm({
          mode: "create",
          date: clubDateOf(Temporal.Now.instant()),
        }),
  );
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const pending = createEvent.isPending || updateEvent.isPending;

  // Re-seed whenever the dialog is opened against a different event,
  // rather than holding the previous one's values behind the close.
  useEffect(() => {
    if (seed) {
      setForm(seedToForm(seed));
    }
  }, [seed]);

  const set = <TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey],
  ) => setForm((prev) => ({ ...prev, [key]: value }));
  const setRecurrence = <TKey extends keyof RecurrenceFormState>(
    key: TKey,
    value: RecurrenceFormState[TKey],
  ) =>
    setForm((prev) => ({
      ...prev,
      recurrence: { ...prev.recurrence, [key]: value },
    }));

  const startInstant = instantFromClubInput(form.startsAt);
  const endInstant = instantFromClubInput(form.endsAt);
  const anchorDate = startInstant ? clubDateOf(startInstant) : null;

  const submit = () => {
    if (!startInstant || !anchorDate) {
      toast.error("Give the event a start time.");
      return;
    }
    if (form.title.trim() === "") {
      toast.error("Give the event a title.");
      return;
    }
    if (endInstant && Temporal.Instant.compare(endInstant, startInstant) < 0) {
      toast.error("The end time is before the start time.");
      return;
    }

    const payload = {
      title: form.title.trim(),
      description:
        form.description.trim() === "" ? null : form.description.trim(),
      location: form.location.trim() === "" ? null : form.location.trim(),
      startsAt: startInstant.epochMilliseconds,
      endsAt: endInstant ? endInstant.epochMilliseconds : null,
      allDay: form.allDay,
      kind: form.kind,
      visibility: form.visibility,
      rrule: buildRrule(form.recurrence, anchorDate),
    };

    const onSuccess = () => {
      toast.success(
        seed?.mode === "edit" ? "Event updated." : "Event created.",
      );
      onOpenChange(false);
    };
    const onError = (err: Error) => toast.error(err.message);

    if (seed?.mode === "edit") {
      updateEvent.mutate(
        { ...payload, publicId: seed.occurrence.publicId },
        { onSuccess, onError },
      );
    } else {
      createEvent.mutate(payload, { onSuccess, onError });
    }
  };

  return (
    <Dialog open={seed !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {seed?.mode === "edit" ? "Edit event" : "New event"}
          </DialogTitle>
          <DialogDescription>
            {seed?.mode === "edit"
              ? "Changes apply to the whole series. To change one occurrence, use “skip or move this one” on the event."
              : "Times are Cincinnati time."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              value={form.title}
              maxLength={EVENT_LIMITS.title.max}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="event-start">Starts</Label>
              <Input
                id="event-start"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => set("startsAt", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-end">Ends</Label>
              <Input
                id="event-end"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => set("endsAt", e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="event-all-day"
              checked={form.allDay}
              onCheckedChange={(checked) => set("allDay", checked === true)}
            />
            <Label htmlFor="event-all-day">All-day event</Label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="event-kind">Type</Label>
              <NativeSelect
                id="event-kind"
                value={form.kind}
                onChange={(e) => set("kind", e.target.value as EventKind)}
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {EVENT_KIND_LABEL[kind]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-visibility">Who can see it</Label>
              <NativeSelect
                id="event-visibility"
                value={form.visibility}
                onChange={(e) =>
                  set("visibility", e.target.value as EventVisibility)
                }
              >
                {VISIBILITIES.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {EVENT_VISIBILITY_LABEL[visibility]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-location">Location</Label>
            <Input
              id="event-location"
              value={form.location}
              maxLength={EVENT_LIMITS.location.max}
              onChange={(e) => set("location", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-description">Details</Label>
            <Textarea
              id="event-description"
              rows={4}
              value={form.description}
              maxLength={EVENT_LIMITS.description.max}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          {/* Repeat controls. Officers never see or type an RRULE — see
           * `recurrence-form.ts` for why. */}
          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Repeats</legend>

            <NativeSelect
              aria-label="Repeat frequency"
              value={form.recurrence.mode}
              onChange={(e) =>
                setRecurrence(
                  "mode",
                  e.target.value as RecurrenceFormState["mode"],
                )
              }
            >
              <option value="none">Does not repeat</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </NativeSelect>

            {form.recurrence.mode === "none" ? null : (
              <>
                <div className="flex items-center gap-2">
                  <Label htmlFor="event-interval" className="shrink-0">
                    Every
                  </Label>
                  <Input
                    id="event-interval"
                    type="number"
                    min={1}
                    max={52}
                    className="w-20"
                    value={form.recurrence.interval}
                    onChange={(e) =>
                      setRecurrence(
                        "interval",
                        Math.max(1, Number(e.target.value) || 1),
                      )
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {form.recurrence.mode === "weekly" ? "week(s)" : "month(s)"}
                  </span>
                </div>

                {form.recurrence.mode === "weekly" ? (
                  <ToggleGroup
                    type="multiple"
                    variant="outline"
                    size="sm"
                    value={form.recurrence.weekdays}
                    onValueChange={(next) =>
                      setRecurrence("weekdays", next as Weekday[])
                    }
                    aria-label="Repeat on"
                  >
                    {WEEKDAYS.map((day) => (
                      <ToggleGroupItem key={day} value={day} aria-label={day}>
                        {WEEKDAY_SHORT[day]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                ) : (
                  <NativeSelect
                    aria-label="Monthly pattern"
                    value={form.recurrence.monthlyMode}
                    onChange={(e) =>
                      setRecurrence(
                        "monthlyMode",
                        e.target.value as RecurrenceFormState["monthlyMode"],
                      )
                    }
                  >
                    <option value="dayOfMonth">On the same date</option>
                    <option value="nthWeekday">On the same weekday</option>
                  </NativeSelect>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    aria-label="Repeat ends"
                    className="w-auto"
                    value={form.recurrence.endMode}
                    onChange={(e) =>
                      setRecurrence(
                        "endMode",
                        e.target.value as RecurrenceFormState["endMode"],
                      )
                    }
                  >
                    <option value="never">Ends never</option>
                    <option value="until">Ends on</option>
                    <option value="count">Ends after</option>
                  </NativeSelect>

                  {form.recurrence.endMode === "until" ? (
                    <Input
                      type="date"
                      aria-label="Repeat until"
                      className="w-auto"
                      value={form.recurrence.untilDate}
                      onChange={(e) =>
                        setRecurrence("untilDate", e.target.value)
                      }
                    />
                  ) : null}
                  {form.recurrence.endMode === "count" ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={500}
                        aria-label="Number of occurrences"
                        className="w-20"
                        value={form.recurrence.count}
                        onChange={(e) =>
                          setRecurrence(
                            "count",
                            Math.max(1, Number(e.target.value) || 1),
                          )
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        times
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Plain-English echo of what was just configured. The
                 * repeat controls are the part of this form an officer
                 * can get wrong without noticing for a semester. */}
                {anchorDate ? (
                  <p className="text-sm text-muted-foreground">
                    {describeRecurrence(form.recurrence, anchorDate)}
                  </p>
                ) : null}
              </>
            )}
          </fieldset>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {seed?.mode === "edit" ? "Save changes" : "Create event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
