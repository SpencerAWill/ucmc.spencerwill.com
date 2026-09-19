import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import {
  getCurrentWaiverStatus,
  requireApproved,
} from "#/features/auth/guards";
import { PageContainer } from "#/components/layouts/page-container";
import { requirePageFlag } from "#/features/settings/api/page-guards";
import { myWaiverStatusQueryOptions } from "#/features/waivers/api/queries";
import { TripSignupEmbed } from "#/features/trips/components/trip-signup-embed";

/**
 * Trip sign-ups — a temporary home for the club's existing Google Form
 * while the real trips feature is built out. Members still need a way to
 * sign up for trips in the meantime, and this keeps that entry point
 * inside the member area rather than a link passed around out-of-band.
 *
 * Gated on `requireApproved` (approved account with a profile) rather
 * than a `trips:*` permission: permissions are DB rows and adding one
 * costs a migration, which isn't worth spending on a surface that gets
 * deleted when the feature lands. The real feature will introduce its
 * own permissions and can tighten this then.
 *
 * `/trips` has no auth-guarded parent layout, so it uses the inline
 * `requirePageFlag` primitive (flag first, so a switched-off page 404s
 * uniformly regardless of who's asking, then the auth guard).
 *
 * `pages.trips` already existed as the sidebar placeholder's flag; it now
 * gates a real route, and the sidebar entry is a real link.
 */
export const Route = createFileRoute("/trips")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "trips");
    await requireApproved(context.queryClient, "/trips");
  },
  // Waiver standing is read for the advisory banner only — deliberately
  // `getCurrentWaiverStatus` (non-blocking) rather than
  // `requireCurrentWaiver` (redirects to /my/waiver). See the component
  // for why signing up isn't gated on attestation.
  loader: ({ context }) => getCurrentWaiverStatus(context.queryClient),
  component: TripsPage,
});

function TripsPage() {
  const { data: waiver } = useSuspenseQuery(myWaiverStatusQueryOptions());

  return (
    <PageContainer width="app" className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Trip sign-ups</h1>
        <p className="text-sm text-muted-foreground">
          Sign up for an upcoming club trip. We&rsquo;re building trips into the
          site properly — until that&rsquo;s ready, sign-ups run through the
          form below.
        </p>
      </header>

      <TripSignupEmbed waiverCurrent={waiver.current !== null} />
    </PageContainer>
  );
}
