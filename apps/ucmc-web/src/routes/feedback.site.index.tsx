import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { useAuth } from "#/features/auth/api/use-auth";
import {
  SITE_FEEDBACK_PERMISSIONS,
  effectivePermissionsFor,
  requireApproved,
} from "#/features/auth/guards";
import {
  mySiteFeedbackQueryOptions,
  siteFeedbackOverviewQueryOptions,
} from "#/features/site-feedback/api/queries";
import { SiteFeedbackCard } from "#/features/site-feedback/components/site-feedback-card";
import { SiteFeedbackForm } from "#/features/site-feedback/components/site-feedback-form";
import { requireEnabledPages } from "#/features/settings/api/page-guards";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

export const Route = createFileRoute("/feedback/site/")({
  staticData: { pageFlag: "feedback_site" },
  beforeLoad: async ({ context, location, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
    const principal = await requireApproved({ context, location });
    const granted = await effectivePermissionsFor(
      context.queryClient,
      principal,
    );
    const canSite = SITE_FEEDBACK_PERMISSIONS.some((p) => granted.includes(p));
    // Unreachable (no site permission) is a 404; `/feedback` only links to
    // surfaces the viewer can reach.
    if (!canSite) {
      throw notFound();
    }
  },
  component: SiteFeedbackPage,
});

function SiteFeedbackPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("site_feedback:manage");
  const canSubmit = hasPermission("site_feedback:submit");

  const flagsQuery = useQuery(publicFlagsQueryOptions());
  const submissionsEnabled = flagsQuery.data?.siteFeedback ?? true;

  const myQuery = useQuery(mySiteFeedbackQueryOptions());

  const overviewQuery = useQuery({
    ...siteFeedbackOverviewQueryOptions(),
    enabled: canManage,
  });
  const untriaged = overviewQuery.data?.untriaged ?? null;

  const mySubmissions = myQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Site feedback</h1>
          <p className="text-sm text-muted-foreground">
            Reaches the site maintainers. Bugs, feature ideas, anything about
            this website.
          </p>
        </div>
        {canManage ? (
          <Link
            to="/feedback/site/triage"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {untriaged === null ? "Triage" : `Triage (${untriaged})`} →
          </Link>
        ) : null}
      </header>
      {canSubmit && submissionsEnabled ? (
        <div className="rounded-md border p-4">
          <SiteFeedbackForm
            pageContext={{
              pageUrl:
                typeof window === "undefined" ? "" : window.location.href,
              userAgent:
                typeof navigator === "undefined" ? "" : navigator.userAgent,
              screenshot: null,
            }}
          />
        </div>
      ) : !submissionsEnabled && canSubmit ? (
        <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          Site feedback submissions are paused right now. Check back later, or
          contact an officer if it&apos;s urgent.
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
                <SiteFeedbackCard entry={entry} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
