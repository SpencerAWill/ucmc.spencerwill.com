import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { useAuth } from "#/features/auth/api/use-auth";
import { requireApproved } from "#/features/auth/guards";
import {
  allFeedbackQueryOptions,
  myFeedbackQueryOptions,
} from "#/features/feedback/api/queries";
import { FeedbackCard } from "#/features/feedback/components/feedback-card";
import { FeedbackForm } from "#/features/feedback/components/feedback-form";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

export const Route = createFileRoute("/feedback/_tabs/")({
  beforeLoad: async ({ context }) => {
    const principal = await requireApproved(context.queryClient);
    const canWebsite =
      principal.permissions.includes("feedback:submit") ||
      principal.permissions.includes("feedback:manage");
    const canClub =
      principal.permissions.includes("club_feedback:submit") ||
      principal.permissions.includes("club_feedback:manage");

    // A user with no access to website feedback but who can see club
    // feedback should land on /feedback/club rather than getting a
    // notFound on their default tab. With access to neither, fall
    // through to notFound — the sidebar entry doesn't render either.
    if (!canWebsite) {
      if (canClub) {
        throw redirect({ to: "/feedback/club" });
      }
      throw notFound();
    }
  },
  component: WebsiteFeedbackPage,
});

function WebsiteFeedbackPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("feedback:manage");
  const canSubmit = hasPermission("feedback:submit");

  const flagsQuery = useQuery(publicFlagsQueryOptions());
  const submissionsEnabled = flagsQuery.data?.websiteFeedback ?? true;

  const myQuery = useQuery(myFeedbackQueryOptions());
  const adminQuery = useQuery(allFeedbackQueryOptions({ enabled: canManage }));

  const mySubmissions = myQuery.data ?? [];
  const allSubmissions = adminQuery.data ?? [];

  return (
    <div className="space-y-6">
      {canSubmit && submissionsEnabled ? (
        <FeedbackForm />
      ) : !submissionsEnabled && canSubmit ? (
        <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          Website feedback submissions are paused right now. Check back later,
          or contact an officer if it&apos;s urgent.
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Your submissions
        </h2>
        {myQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : mySubmissions.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>You haven’t sent any feedback yet.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="space-y-3">
            {mySubmissions.map((entry) => (
              <li key={entry.id}>
                <FeedbackCard
                  entry={entry}
                  showSubmitter={false}
                  canManage={false}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            All feedback (admin)
          </h2>
          {adminQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : allSubmissions.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No feedback submitted yet.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="space-y-3">
              {allSubmissions.map((entry) => (
                <li key={entry.id}>
                  <FeedbackCard entry={entry} showSubmitter canManage />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
