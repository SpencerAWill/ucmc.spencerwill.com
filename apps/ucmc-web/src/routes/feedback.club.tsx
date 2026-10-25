import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePermissionOrNotFound } from "#/features/auth/guards";
import { allClubFeedbackQueryOptions } from "#/features/club-feedback/api/queries";
import { ClubFeedbackCard } from "#/features/club-feedback/components/club-feedback-card";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

/**
 * `/feedback/club` — the exec board's review list. Members send club
 * feedback from the user menu and see their own on `/my/feedback`.
 */
export const Route = createFileRoute("/feedback/club")({
  staticData: { pageFlag: "feedback_club" },
  beforeLoad: async ({ context, location, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
    // A site-only manager passes the layout but has no club backlog.
    await requirePermissionOrNotFound(
      { context, location },
      "club_feedback:manage",
    );
  },
  component: ClubFeedbackPage,
});

function ClubFeedbackPage() {
  const { principal } = useAuth();
  const adminQuery = useQuery(allClubFeedbackQueryOptions({ enabled: true }));
  const allSubmissions = adminQuery.data ?? [];
  const viewerId = principal?.userId ?? null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Club feedback</h1>
        <p className="text-sm text-muted-foreground">
          Sent to the exec board by members. Suggestions, concerns, praise about
          trips, meetings, gear, anything club. Some is anonymous.
        </p>
      </header>
      <section className="space-y-3">
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
    </div>
  );
}
