import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import {
  allFeedbackQueryOptions,
  myFeedbackQueryOptions,
} from "#/features/feedback/api/queries";
import { FeedbackCard } from "#/features/feedback/components/feedback-card";
import { FeedbackForm } from "#/features/feedback/components/feedback-form";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePermission } from "#/features/auth/guards";

export const Route = createFileRoute("/feedback/")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "feedback:submit");
  },
  component: FeedbackPage,
});

function FeedbackPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("feedback:manage");

  const myQuery = useQuery(myFeedbackQueryOptions());
  const adminQuery = useQuery(allFeedbackQueryOptions({ enabled: canManage }));

  const mySubmissions = myQuery.data ?? [];
  const allSubmissions = adminQuery.data ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Feedback</h1>
        <p className="text-sm text-muted-foreground">
          Found a bug, have an idea, or just want to share something? Send it
          here — we read everything.
        </p>
      </header>

      <FeedbackForm />

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
