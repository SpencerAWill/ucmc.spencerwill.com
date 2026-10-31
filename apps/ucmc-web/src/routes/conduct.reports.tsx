import { createFileRoute } from "@tanstack/react-router";

import { ReportsTable } from "#/features/conduct/components/reports-table";
import { requirePageFlag } from "#/features/settings/api/page-guards";

export const Route = createFileRoute("/conduct/reports")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "conduct");
  },
  component: ReportsTable,
});
