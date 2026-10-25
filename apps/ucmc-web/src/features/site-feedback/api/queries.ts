import { siteFeedbackKeys } from "#/features/site-feedback/api/query-keys";
import type { SiteFeedbackTriageView } from "#/features/site-feedback/server/limits";
import {
  getSiteFeedbackOverviewFn,
  listMySiteFeedbackFn,
} from "#/features/site-feedback/server/site-feedback-fns";
import {
  getSiteFeedbackIssueFn,
  listRelatedSiteFeedbackFn,
  listSiteFeedbackTriageFn,
} from "#/features/site-feedback/server/site-feedback-triage-fns";

/**
 * The signed-in member's own submissions, newest-first. 30s staleTime so
 * a fresh submit visibly lands without us hammering the server on every
 * navigation back to /feedback.
 */
export function mySiteFeedbackQueryOptions() {
  return {
    queryKey: siteFeedbackKeys.mine,
    queryFn: () => listMySiteFeedbackFn(),
    staleTime: 30_000,
  } as const;
}

/** Card badge counts for the /feedback index. Same staleness as the lists. */
export function siteFeedbackOverviewQueryOptions() {
  return {
    queryKey: siteFeedbackKeys.overview,
    queryFn: () => getSiteFeedbackOverviewFn(),
    staleTime: 30_000,
  } as const;
}

/** Triage list for one view and search, plus the rail's drafts and filed issues. */
export function siteFeedbackTriageQueryOptions(args: {
  view: SiteFeedbackTriageView;
  q?: string | undefined;
}) {
  const q = args.q?.trim() || undefined;
  return {
    queryKey: siteFeedbackKeys.triage(args.view, q),
    queryFn: () =>
      listSiteFeedbackTriageFn({
        data: q === undefined ? { view: args.view } : { view: args.view, q },
      }),
    staleTime: 15_000,
  } as const;
}

/** One issue (draft or filed) with its linked reports, for the composer. */
export function siteFeedbackIssueQueryOptions(id: string) {
  return {
    queryKey: siteFeedbackKeys.issue(id),
    queryFn: () => getSiteFeedbackIssueFn({ data: { id } }),
    staleTime: 15_000,
  } as const;
}

/** Reports that look related to an issue and aren't linked to it yet. */
export function relatedSiteFeedbackQueryOptions(id: string) {
  return {
    queryKey: siteFeedbackKeys.related(id),
    queryFn: () => listRelatedSiteFeedbackFn({ data: { issueId: id } }),
    staleTime: 15_000,
  } as const;
}
