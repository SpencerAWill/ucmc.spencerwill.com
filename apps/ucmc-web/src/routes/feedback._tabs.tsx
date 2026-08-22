import { Outlet, createFileRoute, useLocation } from "@tanstack/react-router";

import {
  FeedbackTabsBar,
  getFeedbackTabSubtitle,
} from "#/components/layouts/feedback-tabs-bar";
import { requireApproved } from "#/features/auth/guards";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

/**
 * Pathless layout for the two feedback surfaces (Website + Club) that
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

      <FeedbackTabsBar />

      <Outlet />
    </div>
  );
}
