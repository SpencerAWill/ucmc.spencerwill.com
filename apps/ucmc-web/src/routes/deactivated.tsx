import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { PageContainer } from "#/components/layouts/page-container";
import { requireAuth } from "#/features/auth/guards";
import { DeactivatedNotice } from "#/features/conduct/components/deactivated-notice";
import { getMyTerminationNoticeFn } from "#/features/conduct/server/termination-notice-fns";

/**
 * Shown to users whose account has been deactivated by an administrator,
 * and to a terminated member. Requires a session (requireAuth) but NOT
 * approval, except in the two termination cases, which need no session:
 *
 *   - `getMyTerminationNoticeFn` answers, for the account's own surviving
 *     session or a magic-link proof cookie for a blocked address. The
 *     page shows the statement and the appeal route.
 *   - `?reason=terminated`, where the magic-link consume sends a blocked
 *     address (it writes no cookie). The page shows the termination
 *     heading and the appeal route, without a statement, so it reveals
 *     nothing a visitor did not already learn from following the link.
 *
 * Note: loadCurrentPrincipal already cleans up sessions for deactivated
 * users, so the generic copy is mainly reached via the guard redirect
 * during the same request that discovered the status. On subsequent
 * visits the user won't have a session and will land on /sign-in.
 */
export const Route = createFileRoute("/deactivated")({
  validateSearch: z.object({ reason: z.enum(["terminated"]).optional() }),
  beforeLoad: async ({ context, location, search }) => {
    const notice = await getMyTerminationNoticeFn();
    const terminated = search.reason === "terminated";
    if (!notice && !terminated) {
      await requireAuth({ context, location });
    }
    return { notice, terminated };
  },
  component: DeactivatedPage,
});

function DeactivatedPage() {
  const { notice, terminated } = Route.useRouteContext();
  return (
    <PageContainer width="focused" className="flex flex-col gap-6">
      <DeactivatedNotice notice={notice} terminated={terminated} />
    </PageContainer>
  );
}
