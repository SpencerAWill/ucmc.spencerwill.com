import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { useAuth } from "#/features/auth/api/use-auth";
import { requireApproved } from "#/features/auth/guards";
import {
  allClubFeedbackQueryOptions,
  myClubFeedbackQueryOptions,
} from "#/features/club-feedback/api/queries";
import { ClubFeedbackCard } from "#/features/club-feedback/components/club-feedback-card";
import { ClubFeedbackForm } from "#/features/club-feedback/components/club-feedback-form";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

export const Route = createFileRoute("/feedback/_tabs/club")({
  beforeLoad: async ({ context }) => {
    const principal = await requireApproved(context.queryClient);
    const canSeeClub =
      principal.permissions.includes("club_feedback:submit") ||
      principal.permissions.includes("club_feedback:manage");
    if (!canSeeClub) {
      throw notFound();
    }
  },
  component: ClubFeedbackPage,
});

function ClubFeedbackPage() {
  const { principal, hasPermission } = useAuth();
  const canManage = hasPermission("club_feedback:manage");
  const canSubmit = hasPermission("club_feedback:submit");

  const flagsQuery = useQuery(publicFlagsQueryOptions());
  const submissionsEnabled = flagsQuery.data?.clubFeedback ?? true;

  const myQuery = useQuery(myClubFeedbackQueryOptions());
  const adminQuery = useQuery(
    allClubFeedbackQueryOptions({ enabled: canManage }),
  );

  const mySubmissions = myQuery.data ?? [];
  const allSubmissions = adminQuery.data ?? [];
  const viewerId = principal?.userId ?? null;

  return (
    <div className="space-y-6">
      {canSubmit && submissionsEnabled ? (
        <ClubFeedbackForm />
      ) : !submissionsEnabled && canSubmit ? (
        <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          Club feedback submissions are paused right now. Check back later, or
          reach out to an officer directly if it&apos;s urgent.
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
              <EmptyTitle>You haven’t sent any club feedback yet.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="space-y-3">
            {mySubmissions.map((entry) => (
              <li key={entry.id}>
                <ClubFeedbackCard
                  entry={entry}
                  showSubmitter={false}
                  canManage={false}
                  isOwn={entry.createdBy === viewerId}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            All club feedback (admin)
          </h2>
          {adminQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : allSubmissions.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No club feedback submitted yet.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="space-y-3">
              {allSubmissions.map((entry) => (
                <li key={entry.id}>
                  <ClubFeedbackCard
                    entry={entry}
                    showSubmitter
                    canManage
                    isOwn={
                      entry.createdBy !== null && entry.createdBy === viewerId
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
