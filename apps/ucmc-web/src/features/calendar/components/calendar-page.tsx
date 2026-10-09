import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";

import { Plus } from "lucide-react";

import { Button } from "#/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group";
import type { EventKind } from "#/../drizzle/schema";
import { useAuth } from "#/features/auth/api/use-auth";
import { calendarOccurrencesQueryOptions } from "#/features/calendar/api/queries";
import { CalendarAgenda } from "#/features/calendar/components/calendar-agenda";
import { CalendarMonthGrid } from "#/features/calendar/components/calendar-month-grid";
import { EventDetailSheet } from "#/features/calendar/components/event-detail-sheet";
import { EventFormDialog } from "#/features/calendar/components/event-form-dialog";
import type { EventFormSeed } from "#/features/calendar/components/event-form-dialog";
import { EventOfficerActions } from "#/features/calendar/components/event-officer-actions";
import {
  clubToday,
  groupByClubDate,
  monthWindow,
} from "#/features/calendar/lib/calendar-window";
import {
  EVENT_KIND_DOT,
  EVENT_KIND_LABEL,
} from "#/features/calendar/lib/event-display";
import type { CalendarOccurrence } from "#/features/calendar/server/calendar-fns";
import { cn } from "#/lib/utils";

const KIND_ORDER: readonly EventKind[] = [
  "meeting",
  "trip",
  "social",
  "exec",
  "other",
];

/**
 * `/calendar` — month grid plus agenda.
 *
 * **One layout at both breakpoints**, stacked on a phone and
 * side-by-side from `lg`. This is the Apple Calendar / Luma shape; the
 * alternative (a month grid with event chips in the cells, Google's
 * desktop view) needs a dedicated calendar library and is unreadable at
 * 400px, where most members will actually open this.
 *
 * The agenda shows **the whole visible month**, not just the selected
 * day. Selecting a day scrolls the question "what's on the 14th?" into
 * a single tap, but the default reading of a club calendar is "what's
 * coming up" — and a day-at-a-time agenda would make a reader tap
 * through thirty empty days to find out.
 */
export function CalendarPage() {
  /**
   * Officer affordances gate on `hasPermission`, never on
   * `principal.permissions.includes` and never on a field's presence in
   * the payload — both bypass role emulation silently, so a sys admin
   * previewing `member` would still be shown the edit buttons. The
   * server re-checks `events:manage` on every write regardless.
   */
  const { hasPermission } = useAuth();
  const canManage = hasPermission("events:manage");

  const today = clubToday();
  const [month, setMonth] = useState(() =>
    Temporal.PlainYearMonth.from({ year: today.year, month: today.month }),
  );
  const [selected, setSelected] = useState<Temporal.PlainDate>(today);
  const [kinds, setKinds] = useState<EventKind[]>([]);
  const [detail, setDetail] = useState<CalendarOccurrence | null>(null);
  const [formSeed, setFormSeed] = useState<EventFormSeed | null>(null);

  const window = useMemo(() => monthWindow(month), [month]);
  const { data: occurrences } = useSuspenseQuery(
    calendarOccurrencesQueryOptions(
      window.from,
      window.until,
      kinds.length > 0 ? kinds : undefined,
    ),
  );

  const byDate = useMemo(() => groupByClubDate(occurrences), [occurrences]);

  /**
   * Agenda days: every day of the displayed month that has something
   * on it, in order. Built from the month rather than from `byDate`
   * directly, because the fetch window is padded a week either side and
   * those padding days belong to a different month's agenda.
   */
  const agendaDays = useMemo(() => {
    const first = month.toPlainDate({ day: 1 });
    const out: {
      date: Temporal.PlainDate;
      occurrences: CalendarOccurrence[];
    }[] = [];
    for (let day = 0; day < month.daysInMonth; day += 1) {
      const date = first.add({ days: day });
      const found = byDate.get(date.toString());
      if (found && found.length > 0) {
        out.push({ date, occurrences: found });
      }
    }
    return out;
  }, [byDate, month]);

  const isCurrentMonth =
    month.year === today.year && month.month === today.month;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={kinds}
          onValueChange={(next) => setKinds(next as EventKind[])}
          aria-label="Filter by event type"
        >
          {KIND_ORDER.map((kind) => (
            <ToggleGroupItem key={kind} value={kind}>
              <span
                className={cn("size-2 rounded-full", EVENT_KIND_DOT[kind])}
                aria-hidden
              />
              {EVENT_KIND_LABEL[kind]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="flex items-center gap-2">
          {isCurrentMonth ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMonth(
                  Temporal.PlainYearMonth.from({
                    year: today.year,
                    month: today.month,
                  }),
                );
                setSelected(today);
              }}
            >
              Back to today
            </Button>
          )}

          {/* Seeded with the day the officer has selected on the grid,
           * so "tap the 14th, tap New event" fills the date in. */}
          {canManage ? (
            <Button
              size="sm"
              onClick={() => setFormSeed({ mode: "create", date: selected })}
            >
              <Plus />
              New event
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="rounded-lg border p-3">
          <CalendarMonthGrid
            month={month}
            onMonthChange={setMonth}
            selected={selected}
            onSelect={setSelected}
            occurrencesByDate={byDate}
          />
        </div>

        <div className="min-w-0">
          <CalendarAgenda
            days={agendaDays}
            onSelect={setDetail}
            emptyLabel={
              kinds.length > 0
                ? "Nothing of those types this month."
                : "Nothing on the calendar this month yet."
            }
          />
        </div>
      </div>

      <EventDetailSheet
        occurrence={detail}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null);
          }
        }}
        footer={
          detail && canManage ? (
            <EventOfficerActions
              occurrence={detail}
              onEdit={() =>
                setFormSeed({
                  mode: "edit",
                  occurrence: detail,
                  rrule: detail.rrule,
                })
              }
              onDone={() => setDetail(null)}
            />
          ) : undefined
        }
      />

      <EventFormDialog
        seed={formSeed}
        onOpenChange={(open) => {
          if (!open) {
            setFormSeed(null);
          }
        }}
      />
    </div>
  );
}
