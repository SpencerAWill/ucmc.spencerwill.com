import { createFileRoute, redirect } from "@tanstack/react-router";

import { requireApproved } from "#/features/auth/guards";

/**
 * `/feedback` has no page of its own — it redirects to a surface.
 *
 * Club first, because club feedback reaches the exec board and is what most
 * members want; the tab order and the sidebar entry's target agree with it.
 *
 * The choice is permission-aware rather than a blind redirect to
 * `/feedback/club`: that route 404s for anyone without club access, so a
 * member who can only see site feedback would hit a dead end coming from
 * the sidebar or an old `/feedback` bookmark. Falling through to
 * `/feedback/site` lets each surface's own guard decide from there.
 *
 * Deliberately does NOT consult the `pages.*` kill switches. A redirect into
 * a switched-off page still 404s at the destination, which is the same
 * answer, and duplicating the check here would only add a way for the two
 * to disagree.
 */
export const Route = createFileRoute("/feedback/")({
  beforeLoad: async ({ context }) => {
    const principal = await requireApproved(context.queryClient);
    const canClub =
      principal.permissions.includes("club_feedback:submit") ||
      principal.permissions.includes("club_feedback:manage");
    throw redirect({ to: canClub ? "/feedback/club" : "/feedback/site" });
  },
});
