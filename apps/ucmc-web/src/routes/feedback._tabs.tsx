import { Outlet, createFileRoute, useLocation } from "@tanstack/react-router";

import {
  FeedbackTabsBar,
  getFeedbackTabSubtitle,
} from "#/components/layouts/feedback-tabs-bar";
import { PageContainer } from "#/components/layouts/page-container";
import { requireApproved } from "#/features/auth/guards";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

/**
 * Pathless layout for the two feedback surfaces (Site + Club) that
 * share page chrome. Lives under `_tabs` so its tab bar doesn't leak
 * into sibling routes (currently none — but matches the `/members`
 * pattern so future siblings like `/feedback/$id` can opt out cleanly).
 *
 * Gating is intentionally just `requireApproved` here — the per-tab
 * routes stack their own permission + feature-flag checks so direct
 * navigation to a disabled surface surfaces the notFound boundary
 * instead of redirecting.
 */
export const Route = createFileRoute("/feedback/_tabs")({
  beforeLoad: async ({ context, matches }) => {
    // Enforce the active surface's `pages.*` kill switch before the
    // approved-only guard so a disabled surface 404s uniformly instead of
    // redirecting an anonymous visitor to sign-in first.
    await requireEnabledPages(context.queryClient, matches);
    await requireApproved(context.queryClient);
  },
  component: FeedbackTabsLayout,
});

function FeedbackTabsLayout() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const subtitle = getFeedbackTabSubtitle(pathname);

  return (
    <PageContainer width="app" className="flex flex-col gap-6">
      <header className="space-y-1">
        {/* The surface switcher sits on the heading's row, right-aligned:
            two options don't warrant a full-width bar under the header, and
            keeping it up here leaves the subtitle the full column width to
            explain whichever surface is active. */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Feedback</h1>
          <FeedbackTabsBar />
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

      <Outlet />
    </PageContainer>
  );
}
