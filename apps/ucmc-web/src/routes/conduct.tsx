import { Outlet, createFileRoute, useLocation } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { requireAnyPermission } from "#/features/auth/guards";
import {
  ConductTabsBar,
  ConfidentialEyebrow,
} from "#/features/conduct/components/conduct-chrome";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * Layout for `/conduct/*`. The page flag is checked first so a switched-off
 * page 404s for everyone, then `conduct:view` (every holder of
 * `conduct:manage` has it too). Controls that change a record are gated
 * again in the components on `conduct:manage`.
 *
 * The two lists share the title and tabs. A record page brings its own
 * header (a breadcrumb and the member's name as its `h1`), so the layout
 * adds only the container there.
 */
export const Route = createFileRoute("/conduct")({
  beforeLoad: async ({ context, location }) => {
    await requirePageFlag(context.queryClient, "conduct");
    await requireAnyPermission({ context, location }, ["conduct:view"]);
  },
  component: ConductLayout,
});

function isListPath(pathname: string): boolean {
  return (
    pathname.startsWith("/conduct/reports") ||
    pathname.startsWith("/conduct/records")
  );
}

function ConductLayout() {
  const pathname = useLocation({ select: (l) => l.pathname });

  if (!isListPath(pathname)) {
    return (
      <PageContainer width="wide">
        <Outlet />
      </PageContainer>
    );
  }
  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      <header className="space-y-1.5">
        <ConfidentialEyebrow />
        <h1 className="text-2xl font-semibold">Conduct</h1>
        <p className="text-sm text-muted-foreground">
          Member reports, and the club&rsquo;s records of notes, warnings,
          suspensions and terminations.
        </p>
      </header>
      <ConductTabsBar />
      <Outlet />
    </PageContainer>
  );
}
