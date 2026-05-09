import { createFileRoute, redirect } from "@tanstack/react-router";

// The page that used to live here was renamed to "Member management"
// when it grew beyond registration approval (it now also covers
// unclaimed pre-adds, rejected un-reject, and deactivated reactivate).
// This stub keeps existing bookmarks working.
export const Route = createFileRoute("/members/registrations")({
  beforeLoad: () => {
    throw redirect({ to: "/members/management", replace: true });
  },
});
