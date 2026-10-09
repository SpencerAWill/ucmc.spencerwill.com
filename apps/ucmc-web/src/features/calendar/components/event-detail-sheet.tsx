import { CalendarOff, Clock, MapPin, Repeat } from "lucide-react";

import { MarkdownContent } from "#/components/markdown/markdown-content";
import { Badge } from "#/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";
import {
  EVENT_KIND_LABEL,
  EVENT_VISIBILITY_LABEL,
  formatClubDayHeading,
  formatClubTimeRange,
} from "#/features/calendar/lib/event-display";
import { clubDateOf } from "#/features/calendar/lib/calendar-window";

/**
 * One occurrence's detail.
 *
 * A sheet rather than a dialog: it slides from the bottom on a phone
 * and the side on desktop, which keeps the grid visible behind it. A
 * dialog centred over a month grid hides the thing the reader was just
 * looking at.
 */
export function EventDetailSheet({
  occurrence,
  onOpenChange,
  footer,
}: {
  occurrence: CalendarOccurrence | null;
  onOpenChange: (open: boolean) => void;
  /** Officer affordances, injected so this stays read-only. */
  footer?: React.ReactNode;
}) {
  return (
    <Sheet open={occurrence !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {occurrence ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span>{occurrence.title}</span>
                {occurrence.canceled ? (
                  <Badge variant="destructive">
                    <CalendarOff />
                    Cancelled
                  </Badge>
                ) : null}
              </SheetTitle>
              <SheetDescription>
                {formatClubDayHeading(clubDateOf(occurrence.startsAt))}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 pb-4 text-sm">
              <dl className="space-y-2">
                <Row icon={<Clock className="size-4" />} label="Time">
                  {formatClubTimeRange(
                    occurrence.startsAt,
                    occurrence.endsAt,
                    occurrence.allDay,
                  )}
                  {/* Times on this page are club-local throughout. Said
                   * once, here, rather than suffixed onto every row. */}
                  <span className="block text-xs text-muted-foreground">
                    Cincinnati time
                  </span>
                </Row>
                {occurrence.location ? (
                  <Row icon={<MapPin className="size-4" />} label="Location">
                    {occurrence.location}
                  </Row>
                ) : null}
                {occurrence.rrule !== null ? (
                  <Row icon={<Repeat className="size-4" />} label="Repeats">
                    Part of a repeating series
                  </Row>
                ) : null}
              </dl>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {EVENT_KIND_LABEL[occurrence.kind]}
                </Badge>
                <Badge
                  variant={
                    occurrence.visibility === "officers" ? "warning" : "outline"
                  }
                >
                  {EVENT_VISIBILITY_LABEL[occurrence.visibility]}
                </Badge>
              </div>

              {occurrence.description ? (
                <MarkdownContent>{occurrence.description}</MarkdownContent>
              ) : null}

              {footer}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="sr-only">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}
