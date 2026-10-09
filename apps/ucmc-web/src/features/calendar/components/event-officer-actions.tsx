import { CalendarOff, CalendarPlus, Pencil, Trash2, Undo2 } from "lucide-react";
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
import { Separator } from "#/components/ui/separator";
import {
  useCancelEvent,
  useClearOccurrenceOverride,
  useDeleteEvent,
  useOverrideOccurrence,
} from "#/features/calendar/api/use-event-mutations";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";

/**
 * Officer affordances inside the event detail sheet.
 *
 * **Series operations and occurrence operations are kept visibly
 * apart**, under their own headings. An officer skipping one week and
 * an officer calling off the whole series are doing very different
 * things, and the failure mode of conflating them — cancelling a
 * semester when you meant spring break — is not one the undo story
 * covers well.
 */
export function EventOfficerActions({
  occurrence,
  onEdit,
  onDone,
}: {
  occurrence: CalendarOccurrence;
  onEdit: () => void;
  /** Close the sheet after something destructive. */
  onDone: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cancelEvent = useCancelEvent();
  const deleteEvent = useDeleteEvent();
  const overrideOccurrence = useOverrideOccurrence();
  const clearOverride = useClearOccurrenceOverride();

  const pending =
    cancelEvent.isPending ||
    deleteEvent.isPending ||
    overrideOccurrence.isPending ||
    clearOverride.isPending;

  const onError = (err: Error) => toast.error(err.message);
  const isRecurring = occurrence.rrule !== null;

  return (
    <>
      <Separator />

      <div className="space-y-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          This event
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={onEdit}
          disabled={pending}
        >
          <Pencil />
          Edit {isRecurring ? "series" : "event"}
        </Button>

        {/* Only a recurring series has a meaningful "this one" — a
         * one-off's single occurrence IS the series, and offering both
         * would be two buttons that do the same thing. */}
        {isRecurring ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
            disabled={pending}
            onClick={() => {
              const common = {
                publicId: occurrence.publicId,
                occurrenceStart: occurrence.occurrenceStart.epochMilliseconds,
              };
              if (occurrence.canceled) {
                clearOverride.mutate(common, {
                  onSuccess: () => toast.success("Occurrence restored."),
                  onError,
                });
              } else {
                overrideOccurrence.mutate(
                  { ...common, canceled: true },
                  {
                    onSuccess: () => toast.success("Occurrence skipped."),
                    onError,
                  },
                );
              }
            }}
          >
            {occurrence.canceled ? <CalendarPlus /> : <CalendarOff />}
            {occurrence.canceled
              ? "Put this occurrence back"
              : "Skip just this occurrence"}
          </Button>
        ) : null}
      </div>

      <Separator />

      <div className="space-y-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {isRecurring ? "Whole series" : "Danger zone"}
        </p>

        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          disabled={pending}
          onClick={() =>
            cancelEvent.mutate(
              {
                publicId: occurrence.publicId,
                canceled: !occurrence.canceled,
              },
              {
                onSuccess: () =>
                  toast.success(
                    occurrence.canceled
                      ? "Event is back on."
                      : "Event cancelled. Subscribers will see it disappear.",
                  ),
                onError,
              },
            )
          }
        >
          {occurrence.canceled ? <Undo2 /> : <CalendarOff />}
          {occurrence.canceled
            ? "Un-cancel this event"
            : `Cancel ${isRecurring ? "the whole series" : "this event"}`}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 />
          Delete permanently
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{occurrence.title}”?</AlertDialogTitle>
            {/* The distinction that matters, said plainly: deleting
             * removes the event from the feed, which most calendar
             * apps read as "no change" and leave sitting on the
             * subscriber's phone. Cancelling publishes the
             * cancellation, which is what actually makes it go away. */}
            <AlertDialogDescription>
              This removes the event entirely and cannot be undone. If it was on
              the calendar and is now off, cancel it instead — cancelling tells
              people&rsquo;s calendar apps to remove it, whereas deleting
              usually leaves a stale copy on their phone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteEvent.mutate(
                  { publicId: occurrence.publicId },
                  {
                    onSuccess: () => {
                      toast.success("Event deleted.");
                      onDone();
                    },
                    onError,
                  },
                )
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
