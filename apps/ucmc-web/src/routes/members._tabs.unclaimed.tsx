import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { requirePermissionOrNotFound } from "#/features/auth/guards";
import { UnclaimedTab } from "#/features/members/components/unclaimed-tab";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

const unclaimedSearchSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/members/_tabs/unclaimed")({
  staticData: { pageFlag: "members_unclaimed" },
  validateSearch: unclaimedSearchSchema,
  beforeLoad: async ({ context, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
    await requirePermissionOrNotFound(context.queryClient, "members:manage");
  },
  component: UnclaimedRoute,
});

function UnclaimedRoute() {
  const { limit: searchLimit, page: searchPage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;

  return (
    <UnclaimedTab
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
