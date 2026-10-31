import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/trips` is reserved for the real trips feature. Until it lands, the
 * Google Form stopgap lives at `/trip-sign-up` and this keeps links shared
 * before the move working. Replace this file when the feature ships.
 *
 * No page flag of its own: `/trip-sign-up` checks `pages.trip_signup`, so a
 * switched-off page still 404s one hop later.
 */
export const Route = createFileRoute("/trips")({
  beforeLoad: () => {
    throw redirect({ to: "/trip-sign-up" });
  },
});
