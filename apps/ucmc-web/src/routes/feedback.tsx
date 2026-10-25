import {
  Link,
  Outlet,
  createFileRoute,
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
import { requireApproved } from "#/features/auth/guards";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

/**
 * Layout for `/feedback/*`: page chrome plus a breadcrumb. `/feedback` is an
 * index of cards, so the trail is hidden there. Each surface route stacks its
 * own permission and `pages.*` checks; this layout only enforces the master
 * `pages.feedback` switch and sign-in.
 */
export const Route = createFileRoute("/feedback")({
  staticData: { pageFlag: "feedback" },
  beforeLoad: async ({ context, location, matches }) => {
    // Flag first so a switched-off area 404s uniformly instead of sending an
    // anonymous visitor to sign-in.
    await requireEnabledPages(context.queryClient, matches);
    await requireApproved({ context, location });
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
  const isTriage = pathname.startsWith("/feedback/site/triage");

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
              {isTriage ? (
                <BreadcrumbLink asChild>
                  <Link to="/feedback/site">Site</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{surface}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {isTriage ? (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Triage</BreadcrumbPage>
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
