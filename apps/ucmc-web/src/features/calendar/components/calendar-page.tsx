import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { CalendarPlus, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Toggle } from "#/components/ui/toggle";
import type { EventKind } from "#/../drizzle/schema";
import { useAuth } from "#/features/auth/api/use-auth";
import { calendarOccurrencesQueryOptions } from "#/features/calendar/api/queries";
import { CalendarAgenda } from "#/features/calendar/components/calendar-agenda";
import { CalendarMonthGrid } from "#/features/calendar/components/calendar-month-grid";
import { EventFormDialog } from "#/features/calendar/components/event-form-dialog";
import { PublicFeedCard } from "#/features/calendar/components/public-feed-card";
import type { EventFormSeed } from "#/features/calendar/components/event-form-dialog";
import {
  calendarSearchFor,
  kindsFromSearch,
} from "#/features/calendar/lib/calendar-search";
import {
  clubToday,
  groupByClubDate,
  monthWindow,
} from "#/features/calendar/lib/calendar-window";
import {
  EVENT_KIND_DOT,
  EVENT_KIND_LABEL,
  formatClubDayHeading,
  formatClubMonthHeading,
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
 * side-by-side from `lg`. This is the Apple Calendar / Luma shape; a
 * month grid with event chips in the cells (Google's desktop view)
 * needs a dedicated calendar library and is unreadable at 400px, where
 * most members will open this.
 *
 * **The grid is a filter and the agenda is its result.** Tapping a date
 * narrows the agenda to that day; tapping a second extends it to a
 * range. Tap-then-tap rather than click-and-drag, deliberately: drag
 * needs `touch-action: none` on the grid, which would stop the page
 * scrolling past the calendar on a phone, and it has no affordance on
 * touch at all. With no selection the agenda shows the whole month,
 * which is the default reading of a club calendar — "what's coming up".
 *
 * Month, range and type filter all live in the URL, so a reader can
 * link to what they are looking at and the back button walks their
 * filtering. See `lib/calendar-search.ts`.
 */
export function CalendarPage() {
  /**
   * Officer affordances gate on `hasPermission`, never on
   * `principal.permissions.includes` and never on a field's presence in
   * the payload — both bypass role emulation silently. The server
   * re-checks `events:manage` on every write regardless.
   */
  const { hasPermission, isAuthenticated } = useAuth();
  const canManage = hasPermission("events:manage");

  const search = useSearch({ from: "/calendar" });
  const navigate = useNavigate();
  const [formSeed, setFormSeed] = useState<EventFormSeed | null>(null);

  const today = clubToday();
  const currentMonth = Temporal.PlainYearMonth.from({
    year: today.year,
    month: today.month,
  });
  const month = search.month
    ? Temporal.PlainYearMonth.from(search.month)
    : currentMonth;
  const kinds = useMemo(() => kindsFromSearch(search.kind), [search.kind]);
  const range = search.from
    ? {
        from: Temporal.PlainDate.from(search.from),
        to: search.to ? Temporal.PlainDate.from(search.to) : null,
      }
    : null;

  /** Every control is a navigation, so each writes the whole view. */
  const setView = (next: {
    month?: Temporal.PlainYearMonth;
    range?: { from: Temporal.PlainDate; to: Temporal.PlainDate | null } | null;
    kinds?: readonly EventKind[];
  }) =>
    void navigate({
      to: "/calendar",
      search: calendarSearchFor({
        month: next.month ?? month,
        currentMonth,
        range: next.range === undefined ? range : next.range,
        kinds: next.kinds ?? kinds,
      }),
      // The month and the filters are a *view*, not a trail: paging
      // three months forward should leave one back-button press between
      // the reader and where they came from, not three.
      replace: true,
      /**
       * **Every control here is a navigation, so every control would
       * otherwise scroll the page to the top.** Tapping a date on a
       * phone — where the grid sits above the agenda — would throw the
       * reader back to the header on each tap, which reads as the page
       * reloading. The view is changing in place; the viewport should
       * not move.
       */
      resetScroll: false,
    });

  const window = useMemo(() => monthWindow(month), [month]);

  /**
   * **`keepPreviousData`, and no kind filter in the query key.**
   *
   * Both halves stop the page blanking. The key contains the window, so
   * paging months is a new cache entry — under `useSuspenseQuery` that
   * threw to the nearest Suspense boundary and replaced the whole page
   * with its fallback, which reads as a full reload rather than as a
   * month changing.
   *
   * The kind filter is applied client-side, so toggling a type does no
   * network work: the window already holds every event this viewer may
   * see. Re-fetching a subset of what is in memory would make the
   * filter the slowest control on the page and multiply the cache into
   * one entry per filter combination per month. The server fn keeps its
   * `kinds` parameter for the `.ics` feed, whose subscribers cannot
   * filter for themselves.
   */
  const { data, isPending } = useQuery({
    ...calendarOccurrencesQueryOptions(window.from, window.until),
    placeholderData: keepPreviousData,
  });
  const occurrences = useMemo(() => data ?? [], [data]);

  const visible = useMemo(
    () =>
      kinds.length === 0
        ? occurrences
        : occurrences.filter((occurrence) => kinds.includes(occurrence.kind)),
    [occurrences, kinds],
  );

  const byDate = useMemo(() => groupByClubDate(visible), [visible]);

  /**
   * The days the agenda lists: the selected range if there is one,
   * otherwise the whole displayed month.
   *
   * Built by walking dates rather than reading `byDate`'s keys, because
   * the fetch window is padded a week either side and those padding
   * days belong to a neighbouring month's agenda.
   */
  const agendaDays = useMemo(() => {
    const first = range ? range.from : month.toPlainDate({ day: 1 });
    const last = range
      ? (range.to ?? range.from)
      : month.toPlainDate({ day: month.daysInMonth });

    const out: {
      date: Temporal.PlainDate;
      occurrences: CalendarOccurrence[];
    }[] = [];
    let cursor = first;
    while (Temporal.PlainDate.compare(cursor, last) <= 0) {
      const found = byDate.get(cursor.toString());
      if (found && found.length > 0) {
        out.push({ date: cursor, occurrences: found });
      }
      cursor = cursor.add({ days: 1 });
    }
    return out;
  }, [byDate, month, range]);

  const isCurrentMonth =
    Temporal.PlainYearMonth.compare(month, currentMonth) === 0;

  const rangeLabel = range
    ? range.to && Temporal.PlainDate.compare(range.to, range.from) !== 0
      ? `${formatClubDayHeading(range.from)} – ${formatClubDayHeading(range.to)}`
      : formatClubDayHeading(range.from)
    : null;

  return (
    <div className="space-y-6">
      {/* Toolbar. Filters lead because they are what a reader touches;
       * the officer action is trailing and visually separate. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by event type"
        >
          {KIND_ORDER.map((kind) => (
            <Toggle
              key={kind}
              size="sm"
              variant="outline"
              pressed={kinds.includes(kind)}
              onPressedChange={(pressed) =>
                setView({
                  kinds: pressed
                    ? [...kinds, kind]
                    : kinds.filter((value) => value !== kind),
                })
              }
              className="h-8 rounded-full px-3 text-xs data-[state=on]:bg-accent"
            >
              <span
                className={cn("size-2 rounded-full", EVENT_KIND_DOT[kind])}
                aria-hidden
              />
              {EVENT_KIND_LABEL[kind]}
            </Toggle>
          ))}
          {kinds.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground"
              onClick={() => setView({ kinds: [] })}
            >
              Clear
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {/*
           * **Anonymous visitors get no Subscribe button**, because the
           * thing it leads to — minting a personal token — needs an
           * account. They are offered the public feed instead, below
           * the calendar, which is the feed that actually carries what
           * they can see. Linking them to /my/calendar would be a
           * button that bounces them to sign-in.
           */}
          {isAuthenticated ? (
            <Button variant="outline" size="sm" asChild>
              {/* The whole point of the feature for most members: see
               * it once here, subscribe, never open the page again. */}
              <Link to="/my/calendar">
                <CalendarPlus />
                Subscribe
              </Link>
            </Button>
          ) : null}
          {canManage ? (
            <Button
              size="sm"
              onClick={() =>
                setFormSeed({
                  mode: "create",
                  date:
                    range?.from ??
                    (isCurrentMonth ? today : month.toPlainDate({ day: 1 })),
                })
              }
            >
              <Plus />
              New event
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-xl border bg-card p-3 shadow-xs">
            <CalendarMonthGrid
              month={month}
              onMonthChange={(next) => setView({ month: next })}
              range={range}
              onRangeChange={(next) => setView({ range: next })}
              occurrencesByDate={byDate}
            />
          </div>

          {!isCurrentMonth || range ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {isCurrentMonth ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView({ month: currentMonth, range: null })}
                >
                  Back to today
                </Button>
              )}
              {range ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView({ range: null })}
                >
                  <X />
                  Whole month
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-3">
          {/* The agenda says what it is showing. Without it, a range of
           * two quiet days is indistinguishable from a broken page. */}
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {rangeLabel ?? formatClubMonthHeading(month)}
            </h2>
            {agendaDays.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {agendaDays.reduce(
                  (total, day) => total + day.occurrences.length,
                  0,
                )}{" "}
                event
                {agendaDays.reduce(
                  (total, day) => total + day.occurrences.length,
                  0,
                ) === 1
                  ? ""
                  : "s"}
              </p>
            ) : null}
          </div>

          <CalendarAgenda
            days={agendaDays}
            emptyLabel={
              isPending
                ? "Loading…"
                : range
                  ? "Nothing on those dates."
                  : kinds.length > 0
                    ? "Nothing of those types this month."
                    : "Nothing on the calendar this month yet."
            }
          />
        </div>
      </div>

      {/*
       * The public feed, shown to everyone.
       *
       * It lives HERE rather than only on /my/calendar, which was the
       * incoherence this page's opening fixed: the feed exists for
       * people without accounts, and /my/calendar is member-only, so
       * the only viewers of the "share this with anyone" link were the
       * ones who did not need it.
       */}
      {isAuthenticated ? null : <PublicFeedCard />}

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
