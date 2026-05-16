import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { RETENTION_DEACTIVATED_COPY } from "#/config/legal";
import { requirePermissionOrNotFound } from "#/features/auth/guards";
import { LifecycleTab } from "#/features/members/components/lifecycle-tab";

const deactivatedSearchSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/members/_tabs/deactivated")({
  validateSearch: deactivatedSearchSchema,
  beforeLoad: async ({ context }) => {
    await requirePermissionOrNotFound(context.queryClient, "members:manage");
  },
  component: DeactivatedRoute,
});

function DeactivatedRoute() {
  const { limit: searchLimit, page: searchPage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Approved members an officer turned off — sessions revoked, role removed,
        hidden from the directory. Reactivating restores the member role.{" "}
        {RETENTION_DEACTIVATED_COPY}
      </p>

      <LifecycleTab
        kind="deactivated"
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
    </>
  );
}
