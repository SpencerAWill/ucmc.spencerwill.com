import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { useAuth } from "#/features/auth/api/use-auth";
import { calendarOccurrenceQueryOptions } from "#/features/calendar/api/queries";
import { EventDetailSheet } from "#/features/calendar/components/event-detail-sheet";
import { EventFormDialog } from "#/features/calendar/components/event-form-dialog";
import type { EventFormSeed } from "#/features/calendar/components/event-form-dialog";
import { EventOfficerActions } from "#/features/calendar/components/event-officer-actions";

/**
 * One event's detail, as a real URL.
 *
 * Rendered over the calendar by the `/calendar` layout's `<Outlet />`,
 * which is why this is a route rather than component state: the link
 * survives being pasted into an email or GroupMe, and the phone back
 * button closes the sheet instead of leaving the page — which on mobile
 * is the gesture people actually reach for.
 *
 * `occurrence` names which slot of a recurring series is meant
 * (iCalendar's RECURRENCE-ID, as epoch ms). A link without it resolves
 * to the series anchor, which is what a link to a one-off means anyway.
 *
 * **A miss renders nothing rather than 404ing the page.** The id is
 * guessable and the read is visibility-scoped, so "no such event" and
 * "not yours to see" must be indistinguishable — and an event deleted
 * since someone saved the link should leave them on a working calendar,
 * not an error page.
 */
const detailSearchSchema = z.object({
  occurrence: z.coerce.number().int().optional().catch(undefined),
});

export const Route = createFileRoute("/calendar/$publicId")({
  validateSearch: detailSearchSchema,
  loaderDeps: ({ search }) => ({ occurrence: search.occurrence }),
  loader: async ({ context, params, deps }) => {
    await context.queryClient.ensureQueryData(
      calendarOccurrenceQueryOptions(
        params.publicId,
        deps.occurrence === undefined
          ? undefined
          : Temporal.Instant.fromEpochMilliseconds(deps.occurrence),
      ),
    );
  },
  component: EventDetailRoute,
});

function EventDetailRoute() {
  const { publicId } = Route.useParams();
  const { occurrence } = Route.useSearch();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [editing, setEditing] = useState<EventFormSeed | null>(null);

  const { data } = useSuspenseQuery(
    calendarOccurrenceQueryOptions(
      publicId,
      occurrence === undefined
        ? undefined
        : Temporal.Instant.fromEpochMilliseconds(occurrence),
    ),
  );

  /**
   * Closing navigates to `/calendar`, **preserving the search params**
   * so the reader lands back on the month, range and filter they were
   * looking at rather than on today with everything cleared.
   */
  const close = () =>
    void navigate({
      to: "/calendar",
      search: (prev) => prev,
      // Closing an overlay must not move the page under it.
      resetScroll: false,
    });

  if (!data) {
    return null;
  }

  /*
   * The EDIT dialog lives here rather than on the calendar page,
   * because it edits *this* event — the page only owns "new event".
   * Keeping them apart means neither has to reach into the other's
   * state across a route boundary.
   */
  return (
    <>
      <EventDetailSheet
        occurrence={data}
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
        footer={
          hasPermission("events:manage") ? (
            <EventOfficerActions
              occurrence={data}
              onEdit={() =>
                setEditing({
                  mode: "edit",
                  occurrence: data,
                  rrule: data.rrule,
                })
              }
              onDone={close}
            />
          ) : undefined
        }
      />

      <EventFormDialog
        seed={editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
      />
    </>
  );
}
