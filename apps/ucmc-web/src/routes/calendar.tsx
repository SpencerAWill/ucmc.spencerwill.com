import { createFileRoute } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { requireApproved } from "#/features/auth/guards";
import { calendarOccurrencesQueryOptions } from "#/features/calendar/api/queries";
import { CalendarPage } from "#/features/calendar/components/calendar-page";
import {
  clubToday,
  monthWindow,
} from "#/features/calendar/lib/calendar-window";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * The club calendar (issue #187).
 *
 * Gated on `requireApproved` rather than an `events:view` permission.
 * Being an approved member IS the qualification, the same call /trips
 * made — a read permission here would be granted to `role_member` on
 * day one and never revoked from anyone. What an individual member can
 * *see* on the page is decided per event by `visibility`, server-side.
 *
 * `/calendar` has no auth-guarded parent layout, so it uses the inline
 * `requirePageFlag` primitive, flag first: a switched-off page 404s
 * uniformly regardless of who is asking, and only then does the auth
 * guard run.
 *
 * `pages.calendar` already existed as the sidebar placeholder's flag;
 * it now gates a real route and the sidebar entry is a real link.
 */
export const Route = createFileRoute("/calendar")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "calendar");
    await requireApproved(context.queryClient, "/calendar");
  },
  /**
   * Prefetch the month the page opens on, so SSR has it baked in and
   * the first paint carries events rather than an empty agenda that
   * fills in a beat later. The component reads the same key, so this is
   * a cache warm rather than a second fetch.
   *
   * The window is derived in `CLUB_TIME_ZONE` exactly as the component
   * derives it — any disagreement here would miss the cache and silently
   * undo the prefetch.
   */
  loader: async ({ context }) => {
    const today = clubToday();
    const { from, until } = monthWindow(
      Temporal.PlainYearMonth.from({ year: today.year, month: today.month }),
    );
    await context.queryClient.ensureQueryData(
      calendarOccurrencesQueryOptions(from, until),
    );
  },
  component: CalendarRoute,
});

function CalendarRoute() {
  return (
    <PageContainer width="app" className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Meetings, trips and everything else the club has on. All times are
          Cincinnati time.
        </p>
      </header>

      <CalendarPage />
    </PageContainer>
  );
}
