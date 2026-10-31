import { Link, Outlet, createFileRoute } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { requireAnyPermission } from "#/features/auth/guards";
import { requirePageFlag } from "#/features/settings/api/page-guards";

/**
 * Layout for `/conduct/*`. The page flag is checked first so a switched-off
 * page 404s for everyone, then `conduct:view` (every holder of
 * `conduct:manage` has it too). Controls that change a record are gated
 * again in the components on `conduct:manage`.
 */
export const Route = createFileRoute("/conduct")({
  beforeLoad: async ({ context, location }) => {
    await requirePageFlag(context.queryClient, "conduct");
    await requireAnyPermission({ context, location }, ["conduct:view"]);
  },
  component: ConductLayout,
});

function ConductLayout() {
  return (
    <PageContainer width="wide" className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Conduct</h1>
        <p className="text-sm text-muted-foreground">
          Member reports, and records of notes, warnings, suspensions and
          terminations. Visible only to conduct officers.
        </p>
      </header>
      <nav aria-label="Conduct sections" className="flex gap-2 border-b pb-2">
        <Link
          to="/conduct/reports"
          className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-accent"
          activeProps={{ className: "bg-secondary" }}
        >
          Reports
        </Link>
        <Link
          to="/conduct/records"
          className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-accent"
          activeProps={{ className: "bg-secondary" }}
        >
          Records
        </Link>
      </nav>
      <Outlet />
    </PageContainer>
  );
}
