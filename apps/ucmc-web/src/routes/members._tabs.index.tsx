import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { ApprovedTab } from "#/features/members/components/approved-tab";
import type {
  ApprovedSortOption,
  ApprovedViewMode,
} from "#/features/members/components/approved-tab";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

const approvedSearchSchema = z.object({
  q: z.string().optional(),
  affiliations: z.string().optional(), // comma-separated values
  roles: z.string().optional(), // comma-separated values
  sort: z.enum(["name_asc", "name_desc", "newest", "oldest"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
  view: z.enum(["list", "grid"]).optional(),
});

// `requireApproved` is enforced by the `_tabs` layout parent — no need
// to re-check here.
export const Route = createFileRoute("/members/_tabs/")({
  staticData: { pageFlag: "members_approved" },
  beforeLoad: async ({ context, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
  },
  validateSearch: approvedSearchSchema,
  component: ApprovedRoute,
});

function ApprovedRoute() {
  const {
    q: search,
    affiliations: affiliationsParam,
    roles: rolesParam,
    sort,
    limit: searchLimit,
    page: searchPage,
    view: searchView,
  } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const perPage = searchLimit ?? 50;
  const page = searchPage ?? 1;
  const view: ApprovedViewMode = searchView ?? "list";

  const affiliations = affiliationsParam?.split(",").filter(Boolean) ?? [];
  const roles = rolesParam?.split(",").filter(Boolean) ?? [];

  const updateSearch = (
    updates: Partial<{
      q: string | undefined;
      affiliations: string | undefined;
      roles: string | undefined;
      sort: ApprovedSortOption | undefined;
      limit: number | undefined;
      page: number | undefined;
      view: ApprovedViewMode | undefined;
    }>,
  ) => {
    void navigate({
      search: (prev) => ({ ...prev, ...updates }),
    });
  };

  return (
    <ApprovedTab
      search={search}
      affiliations={affiliations}
      roles={roles}
      sort={sort ?? "name_asc"}
      perPage={perPage}
      page={page}
      view={view}
      onAffiliationsChange={(next) =>
        updateSearch({
          affiliations: next.length > 0 ? next.join(",") : undefined,
          page: undefined,
        })
      }
      onRolesChange={(next) =>
        updateSearch({
          roles: next.length > 0 ? next.join(",") : undefined,
          page: undefined,
        })
      }
      onSortChange={(value) =>
        updateSearch({
          sort: value === "name_asc" ? undefined : value,
          page: undefined,
        })
      }
      onPerPageChange={(value) =>
        updateSearch({ limit: Number(value), page: undefined })
      }
      onPageChange={(p) => updateSearch({ page: p === 1 ? undefined : p })}
      onViewChange={(mode) =>
        updateSearch({ view: mode === "list" ? undefined : mode })
      }
      onClearFilters={() =>
        updateSearch({
          affiliations: undefined,
          roles: undefined,
          page: undefined,
        })
      }
    />
  );
}
