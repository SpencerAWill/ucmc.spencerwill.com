import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useCallback } from "react";
import { z } from "zod";

import { Button } from "#/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible";
import { requirePermission } from "#/features/auth/guards";
import { requireEnabledPages } from "#/features/settings/api/page-guards";
import { siteFeedbackTriageQueryOptions } from "#/features/site-feedback/api/queries";
import { TriageInbox } from "#/features/site-feedback/components/triage/triage-inbox";
import { TriageIssueRail } from "#/features/site-feedback/components/triage/triage-issue-rail";
import { SITE_FEEDBACK_TRIAGE_VIEW_VALUES } from "#/features/site-feedback/server/limits";
import type { SiteFeedbackTriageView } from "#/features/site-feedback/server/limits";

const triageSearchSchema = z.object({
  view: z.enum(SITE_FEEDBACK_TRIAGE_VIEW_VALUES).default("new"),
  q: z.string().trim().max(200).optional(),
});

export const Route = createFileRoute("/feedback/site/triage/")({
  validateSearch: triageSearchSchema,
  beforeLoad: async ({ context, location, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
    await requirePermission({ context, location }, "site_feedback:manage");
  },
  component: SiteFeedbackTriagePage,
});

function SiteFeedbackTriagePage() {
  const { view, q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useQuery({
    ...siteFeedbackTriageQueryOptions({ view, q }),
    placeholderData: (previous) => previous,
  });

  const onViewChange = useCallback(
    (next: SiteFeedbackTriageView) => {
      void navigate({
        search: (prev) => ({ ...prev, view: next }),
        replace: true,
      });
    },
    [navigate],
  );
  const onQueryChange = useCallback(
    (next: string | undefined) => {
      void navigate({
        search: (prev) => ({ ...prev, q: next }),
        replace: true,
      });
    },
    [navigate],
  );

  const data = query.data;
  const rail = data ? (
    <TriageIssueRail
      drafts={data.drafts}
      openIssues={data.openIssues}
      githubConfigured={data.githubConfigured}
      lastSyncedAt={data.lastSyncedAt}
    />
  ) : null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Triage site feedback</h1>
        <p className="text-sm text-muted-foreground">
          Group reports into GitHub issues, or close them out.
        </p>
      </header>
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load reports: {query.error.message}
        </p>
      ) : data === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
          <Collapsible className="md:hidden">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline" className="w-full">
                Drafts and filed issues ({data.drafts.length}/
                {data.openIssues.length})
                <ChevronDown aria-hidden="true" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">{rail}</CollapsibleContent>
          </Collapsible>
          <TriageInbox
            data={data}
            view={view}
            q={q}
            onViewChange={onViewChange}
            onQueryChange={onQueryChange}
          />
          <aside className="hidden md:block">{rail}</aside>
        </div>
      )}
    </div>
  );
}
