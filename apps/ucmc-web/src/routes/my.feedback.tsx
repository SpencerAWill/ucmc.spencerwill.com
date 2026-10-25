import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { useAuth } from "#/features/auth/api/use-auth";
import {
  canReachMyFeedback,
  effectivePermissionsFor,
  requireApproved,
} from "#/features/auth/guards";
import { myClubFeedbackQueryOptions } from "#/features/club-feedback/api/queries";
import { ClubFeedbackCard } from "#/features/club-feedback/components/club-feedback-card";
import { requirePageFlag } from "#/features/settings/api/page-guards";
import { mySiteFeedbackQueryOptions } from "#/features/site-feedback/api/queries";
import { SiteFeedbackCard } from "#/features/site-feedback/components/site-feedback-card";

/**
 * `/my/feedback` — everything the member has sent, both surfaces on one
 * page. The managers' `/feedback` area no longer lists a member's own
 * submissions, so this is where a submitter follows theirs up. A direct
 * sibling of `/my/gear`: no account tabs.
 *
 * A viewer who can send to neither surface gets the 404, since the page
 * would only ever be empty for them.
 */
export const Route = createFileRoute("/my/feedback")({
  staticData: { pageFlag: "my_feedback" },
  beforeLoad: async ({ context, location }) => {
    await requirePageFlag(context.queryClient, "my_feedback");
    const principal = await requireApproved({ context, location });
    const granted = await effectivePermissionsFor(
      context.queryClient,
      principal,
    );
    if (!canReachMyFeedback(granted)) {
      throw notFound();
    }
  },
  component: MyFeedbackPage,
});

function MyFeedbackPage() {
  const { hasPermission } = useAuth();
  const canSite = hasPermission("site_feedback:submit");
  const canClub = hasPermission("club_feedback:submit");

  return (
    <PageContainer width="app" className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">My feedback</h1>
        <p className="text-sm text-muted-foreground">
          What you&apos;ve sent to the site maintainers and the exec board.
        </p>
      </header>
      {canSite ? <MySiteFeedback /> : null}
      {canClub ? <MyClubFeedback /> : null}
    </PageContainer>
  );
}

function MySiteFeedback() {
  const query = useQuery(mySiteFeedbackQueryOptions());
  const entries = query.data ?? [];
  return (
    <section className="space-y-3" aria-labelledby="my-feedback-site">
      <h2 id="my-feedback-site" className="text-lg font-medium">
        Website
      </h2>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <NothingYet />
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <SiteFeedbackCard entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MyClubFeedback() {
  const query = useQuery(myClubFeedbackQueryOptions());
  const entries = query.data ?? [];
  return (
    <section className="space-y-3" aria-labelledby="my-feedback-club">
      <h2 id="my-feedback-club" className="text-lg font-medium">
        Club
      </h2>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <NothingYet />
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <ClubFeedbackCard
                entry={entry}
                showSubmitter={false}
                canManage={false}
                isOwn
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NothingYet() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>Nothing yet</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}
