import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { requireApproved } from "#/features/auth/guards";
import { calendarOccurrencesQueryOptions } from "#/features/calendar/api/queries";
import { CalendarPage } from "#/features/calendar/components/calendar-page";
import { calendarSearchSchema } from "#/features/calendar/lib/calendar-search";
import {
  clubToday,
  monthWindow,
} from "#/features/calendar/lib/calendar-window";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * The club calendar (issue #187).
 *
 * A **layout** route: it renders the calendar and an `<Outlet />`, so
 * `/calendar/$publicId` draws an event's detail sheet *over* the
 * calendar rather than replacing it. `/calendar` itself renders the
 * empty index child.
 *
 * Gated on `requireApproved` rather than an `events:view` permission.
 * Being an approved member IS the qualification, the same call /trips
 * made — a read permission would be granted to `role_member` on day one
 * and never revoked from anyone. What an individual member can *see* is
 * decided per event by `visibility`, server-side.
 *
 * Flag first, then auth: a switched-off page 404s uniformly regardless
 * of who is asking.
 */
export const Route = createFileRoute("/calendar")({
  validateSearch: calendarSearchSchema,
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "calendar");
    await requireApproved(context.queryClient, "/calendar");
  },
  /**
   * Prefetch the month being shown so SSR has it baked in and the first
   * paint carries events rather than an empty agenda that fills in a
   * beat later.
   *
   * It reads `month` from the search params, so a shared link to a
   * different month is server-rendered with *that* month's events — not
   * today's, followed by a visible swap. The window is derived exactly
   * as the component derives it; any disagreement would miss the cache
   * and silently undo the prefetch.
   */
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: async ({ context, deps }) => {
    const today = clubToday();
    const month = deps.month
      ? Temporal.PlainYearMonth.from(deps.month)
      : Temporal.PlainYearMonth.from({
          year: today.year,
          month: today.month,
        });
    const { from, until } = monthWindow(month);
    await context.queryClient.ensureQueryData(
      calendarOccurrencesQueryOptions(from, until),
    );
  },
  component: CalendarLayout,
});

function CalendarLayout() {
  return (
    <PageContainer width="wide" className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        {/*
         * **The second sentence is the one that matters**, and it says
         * what subscribing DOES rather than what it is. Most members
         * have never heard of an .ics feed and never need to: the thing
         * worth knowing is that this can live in the calendar app they
         * already open every day, and that it stays current on its own.
         * Naming the format here would teach them a word instead of a
         * reason.
         */}
        <p className="text-sm text-muted-foreground">
          Meetings, trips and everything else the club has on, in Cincinnati
          time. Add it to your phone once and club events keep appearing in your
          own calendar &mdash; nothing to install, and nothing to check back
          for.
        </p>
      </header>

      <CalendarPage />
      <Outlet />
    </PageContainer>
  );
}
