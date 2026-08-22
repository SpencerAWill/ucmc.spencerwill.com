import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { requirePermissionOrNotFound } from "#/features/auth/guards";
import { LifecycleTab } from "#/features/members/components/lifecycle-tab";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

const rejectedSearchSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/members/_tabs/rejected")({
  staticData: { pageFlag: "members_rejected" },
  validateSearch: rejectedSearchSchema,
  beforeLoad: async ({ context, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
    await requirePermissionOrNotFound(context.queryClient, "members:manage");
  },
  component: RejectedRoute,
});

function RejectedRoute() {
  const { limit: searchLimit, page: searchPage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;

  return (
    <LifecycleTab
      kind="rejected"
      perPage={perPage}
      page={page}
      onPerPageChange={(value) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            limit: Number(value),
            page: undefined,
          }),
        })
      }
      onPageChange={(p) =>
        void navigate({
          search: (prev) => ({ ...prev, page: p === 1 ? undefined : p }),
        })
      }
    />
  );
}
