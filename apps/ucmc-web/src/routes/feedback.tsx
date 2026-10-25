import {
  Link,
  Outlet,
  createFileRoute,
  notFound,
  redirect,
  useLocation,
} from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import {
  effectivePermissionsFor,
  feedbackAreaDecision,
  requireApproved,
} from "#/features/auth/guards";
import { requireEnabledPages } from "#/features/settings/api/page-guards";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

/**
 * Layout for `/feedback/*`, the managers' area: page chrome plus a
 * breadcrumb (hidden on the index of cards). It enforces the master
 * `pages.feedback` switch, sign-in, and that the viewer manages at least
 * one surface; anyone else goes to `/my/feedback` (or 404s when that page
 * is off). Each surface route stacks its own manage and `pages.*` checks.
 */
export const Route = createFileRoute("/feedback")({
  staticData: { pageFlag: "feedback" },
  beforeLoad: async ({ context, location, matches }) => {
    // Flag first so a switched-off area 404s uniformly instead of sending an
    // anonymous visitor to sign-in.
    await requireEnabledPages(context.queryClient, matches);
    const principal = await requireApproved({ context, location });
    const [granted, flags] = await Promise.all([
      effectivePermissionsFor(context.queryClient, principal),
      context.queryClient.ensureQueryData(publicFlagsQueryOptions()),
    ]);
    const decision = feedbackAreaDecision(granted, flags.pages.my_feedback);
    if (decision === "redirect_my_feedback") {
      throw redirect({ to: "/my/feedback" });
    }
    if (decision === "not_found") {
      throw notFound();
    }
  },
  component: FeedbackLayout,
});

function surfaceLabel(pathname: string): string | null {
  if (pathname.startsWith("/feedback/club")) {
    return "Club";
  }
  if (pathname.startsWith("/feedback/site")) {
    return "Site";
  }
  return null;
}

function FeedbackLayout() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const surface = surfaceLabel(pathname);
  // `/feedback/site` itself is the triage inbox now, so the only page
  // deeper than a surface is an issue in the composer.
  const isIssue = pathname.startsWith("/feedback/site/triage/issues/");

  return (
    <PageContainer width="app" className="flex flex-col gap-6">
      {surface ? (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/feedback">Feedback</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {isIssue ? (
                <BreadcrumbLink asChild>
                  <Link to="/feedback/site/triage">Site</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{surface}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {isIssue ? (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Issue</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : null}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      <Outlet />
    </PageContainer>
  );
}
