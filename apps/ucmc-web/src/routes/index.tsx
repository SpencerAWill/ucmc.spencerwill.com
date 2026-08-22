import { createFileRoute } from "@tanstack/react-router";

import { landingContentQueryOptions } from "#/features/landing/api/queries";
import { About } from "#/features/landing/components/about";
import { Activities } from "#/features/landing/components/activities";
import { Faq } from "#/features/landing/components/faq";
import { Hero } from "#/features/landing/components/hero";
import { HowToJoin } from "#/features/landing/components/how-to-join";
import { MeetingInfo } from "#/features/landing/components/meeting-info";
import { Officers } from "#/features/landing/components/officers";
import { PhotoCarousel } from "#/features/landing/components/photo-carousel";

export const Route = createFileRoute("/")({
  // No `pages.*` kill switch: `/` is intentionally always reachable. It's
  // the target of the header logo, sign-out, post-deletion, the
  // permission-denied redirect in `requirePermission`, and the not-found /
  // error pages' own "home" links — none of which consult the flag, so a
  // disableable home would soft-brick every one of those fallbacks.
  // Prefetch the landing-content bundle so SSR has the data baked in and
  // every section component reads from a hot cache on first render.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(landingContentQueryOptions());
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex flex-1 flex-col">
      <Hero />
      <About />
      <Activities />
      <HowToJoin />
      <PhotoCarousel />
      <Officers />
      <MeetingInfo />
      <Faq />
    </div>
  );
}
