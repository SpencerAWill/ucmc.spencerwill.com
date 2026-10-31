import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { useAuth } from "#/features/auth/api/use-auth";
import { getWaiverStatusIfApproved } from "#/features/auth/guards";
import { PageContainer } from "#/components/layouts/page-container";
import { requirePageFlag } from "#/features/settings/api/page-guards";
import { myWaiverStatusQueryOptions } from "#/features/waivers/api/queries";
import { TripSignupEmbed } from "#/features/trips/components/trip-signup-embed";

/**
 * Trip sign-ups — a temporary home for the club's existing Google Form
 * while the real trips feature is built out. It lives at `/trip-sign-up`
 * rather than `/trips` so that URL stays free for the real feature;
 * `/trips` redirects here until then.
 *
 * Public, like the form itself: anyone with the link could already fill it
 * in, so gating the page on an account only hid the entry point. The page
 * flag is the only gate. There is deliberately no `public_*:view`
 * permission — permissions are DB rows and adding one costs a migration,
 * which isn't worth spending on a surface that gets deleted when the
 * feature lands.
 */
export const Route = createFileRoute("/trip-sign-up")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "trip_signup");
  },
  // Waiver standing is read for the advisory banner only, and only for an
  // approved member — see the component for why signing up isn't gated
  // on attestation. A failed read drops the banner rather than erroring
  // the page: the form is the point, the banner is a nicety.
  loader: ({ context }) =>
    getWaiverStatusIfApproved(context.queryClient).catch(() => null),
  component: TripSignUpPage,
});

function TripSignUpPage() {
  const { isApproved } = useAuth();
  const { data: waiver } = useQuery({
    ...myWaiverStatusQueryOptions(),
    enabled: isApproved,
  });

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

      <TripSignupEmbed
        waiverCurrent={
          isApproved && waiver !== undefined ? waiver.current !== null : null
        }
      />
    </PageContainer>
  );
}
