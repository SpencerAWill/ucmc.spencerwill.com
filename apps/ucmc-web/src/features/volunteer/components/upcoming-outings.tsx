import {
  CalendarDays,
  ExternalLink,
  MapPin,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { formatDateTime } from "#/lib/date-format";
import { outingJoinHref } from "#/features/volunteer/lib/join-link";
import type { VolunteerEventEntry } from "#/features/volunteer/server/volunteer-fns";

/**
 * The outings a member can still sign up for, soonest first.
 *
 * Dates render through `formatDateTime` in the **viewer's** zone, not
 * the club's: the band answers "can I be there", which is a question
 * about the reader's own clock. (The club zone decides which band a row
 * lands in — that's a calendar-boundary question, and it's settled
 * server-side.)
 */
export function UpcomingOutings({
  outings,
  clubEmail,
  canManage = false,
  onEdit,
  onDelete,
}: {
  outings: VolunteerEventEntry[];
  clubEmail?: string | null;
  canManage?: boolean;
  onEdit?: (outing: VolunteerEventEntry) => void;
  onDelete?: (outing: VolunteerEventEntry) => void;
}) {
  if (outings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing on the calendar right now. New outings are posted here — or get
        in touch and we'll let you know when the next one lands.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {outings.map((outing) => {
        const startsAt = Temporal.Instant.fromEpochMilliseconds(
          outing.startsAtMs,
        );
        const join = outingJoinHref(outing, clubEmail);
        return (
          <li key={outing.id}>
            <Card>
              <CardContent className="space-y-2 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <h3 className="font-semibold leading-tight">
                      {outing.title}
                    </h3>
                    {outing.partnerOrg ? (
                      <p className="text-sm text-muted-foreground">
                        with {outing.partnerOrg}
                      </p>
                    ) : null}
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 gap-1">
                      {onEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Edit ${outing.title}`}
                          onClick={() => onEdit(outing)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      ) : null}
                      {onDelete ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Delete ${outing.title}`}
                          onClick={() => onDelete(outing)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <dt className="sr-only">Starts</dt>
                    <CalendarDays className="size-4" aria-hidden="true" />
                    <dd>
                      {formatDateTime(startsAt, {
                        dateStyle: "full",
                        timeStyle: "short",
                      })}
                    </dd>
                  </div>
                  {outing.location ? (
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Where</dt>
                      <MapPin className="size-4" aria-hidden="true" />
                      <dd>{outing.location}</dd>
                    </div>
                  ) : null}
                </dl>
                {outing.description ? (
                  <p className="text-sm leading-relaxed">
                    {outing.description}
                  </p>
                ) : null}
                {join ? (
                  <div className="pt-1">
                    <Button asChild size="sm">
                      <a
                        href={join.href}
                        {...(join.external
                          ? { target: "_blank", rel: "noreferrer noopener" }
                          : {})}
                      >
                        Join this one
                        {join.external ? (
                          <ExternalLink className="size-3.5" />
                        ) : null}
                      </a>
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
