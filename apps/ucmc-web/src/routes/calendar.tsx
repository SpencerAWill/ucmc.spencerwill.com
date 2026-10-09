import { createFileRoute } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { requireApproved } from "#/features/auth/guards";
import { CalendarPage } from "#/features/calendar/components/calendar-page";
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
