import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import {
  CLUB_FEEDBACK_PERMISSIONS,
  SITE_FEEDBACK_PERMISSIONS,
  effectivePermissionsFor,
  requireApproved,
} from "#/features/auth/guards";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

/**
 * `/feedback` has no page of its own — it redirects to a surface.
 *
 * Club first, because club feedback reaches the exec board and is what most
 * members want; the tab order and the sidebar entry's target agree with it.
 *
 * The choice is permission- AND flag-aware rather than a blind redirect to
 * `/feedback/club`: that route 404s for anyone without club access or with
 * `pages.feedback_club` switched off, so a member who can only reach site
 * feedback would hit a dead end coming from the sidebar or an old
 * `/feedback` bookmark. Picking a surface the viewer can actually reach
 * matters more here than anywhere else, because the destination's own
 * sibling fallback runs *after* `requireEnabledPages` has already thrown —
 * it can rescue a missing permission, but not a switched-off page.
 *
 * When neither surface is reachable this 404s directly instead of bouncing
 * to one that will: same answer, one fewer navigation.
 */
export const Route = createFileRoute("/feedback/")({
  beforeLoad: async ({ context }) => {
    const principal = await requireApproved(context.queryClient);
    const flags = await context.queryClient.ensureQueryData(
      publicFlagsQueryOptions(),
    );
    // Effective (preview-aware) permissions, not `principal.permissions`:
    // a role preview has to pick the same surface the sidebar entry and
    // the tab bar do, or previewing a member redirects to a surface the
    // chrome has already hidden.
    const granted = await effectivePermissionsFor(
      context.queryClient,
      principal,
    );
    const canClub =
      flags.pages.feedback_club &&
      CLUB_FEEDBACK_PERMISSIONS.some((p) => granted.includes(p));
    if (canClub) {
      throw redirect({ to: "/feedback/club" });
    }
    const canSite =
      flags.pages.feedback_site &&
      SITE_FEEDBACK_PERMISSIONS.some((p) => granted.includes(p));
    if (canSite) {
      throw redirect({ to: "/feedback/site" });
    }
    throw notFound();
  },
});
