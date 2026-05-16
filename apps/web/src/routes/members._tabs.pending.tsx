import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { requirePermissionOrNotFound } from "#/features/auth/guards";
import { PendingTab } from "#/features/members/components/pending-tab";

const pendingSearchSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const Route = createFileRoute("/members/_tabs/pending")({
  validateSearch: pendingSearchSchema,
  beforeLoad: async ({ context }) => {
    await requirePermissionOrNotFound(context.queryClient, "members:manage");
  },
  component: PendingRoute,
});

function PendingRoute() {
  const { from, to, limit: searchLimit, page: searchPage } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        New registrations awaiting an officer’s decision. Approving grants the
        &quot;member&quot; role automatically.
      </p>

      <PendingTab
        from={from}
        to={to}
        perPage={perPage}
        page={page}
        onDateRangeChange={(nextFrom, nextTo) =>
          void navigate({
            search: (prev) => ({
              ...prev,
              from: nextFrom,
              to: nextTo,
              page: undefined, // reset on filter change
            }),
          })
        }
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
