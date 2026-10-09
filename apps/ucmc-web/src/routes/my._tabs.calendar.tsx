import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import { mySubscriptionsQueryOptions } from "#/features/calendar/api/queries";
import { SubscribePanel } from "#/features/calendar/components/subscribe-panel";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * `/my/calendar` — the member's calendar subscription links.
 *
 * Its own tab rather than a section of Preferences: a subscription URL
 * is a credential with a lifecycle (mint, use, rotate, revoke), which
 * is the Security tab's shape rather than the Preferences tab's
 * settings-and-switches one — but it is not an authentication
 * credential either, so it does not belong beside passkeys. It gets its
 * own tab for the same reason Waiver has one: a small surface a member
 * visits rarely and needs to find immediately when they do.
 *
 * Auth-gating is inherited from the parent `/my` layout, which runs
 * `requireApproved` for the entire `/my/*` namespace.
 */
export const Route = createFileRoute("/my/_tabs/calendar")({
  staticData: { pageFlag: "my_calendar" },
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "my_calendar");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(mySubscriptionsQueryOptions());
  },
  component: MyCalendarPage,
});

function MyCalendarPage() {
  return (
    <div className="space-y-6">
      <SubscribePanel />

      <p className="text-sm text-muted-foreground">
        Looking for what&rsquo;s coming up?{" "}
        <Button variant="link" className="h-auto p-0" asChild>
          <Link to="/calendar">Open the club calendar</Link>
        </Button>
        .
      </p>
    </div>
  );
}
