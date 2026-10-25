import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/feedback/site` is the triage inbox. Members send site feedback from
 * the user menu and follow it up on `/my/feedback`, so the old form-and-list
 * page is gone; this keeps old links and bookmarks working.
 */
export const Route = createFileRoute("/feedback/site/")({
  beforeLoad: () => {
    throw redirect({ to: "/feedback/site/triage" });
  },
});
