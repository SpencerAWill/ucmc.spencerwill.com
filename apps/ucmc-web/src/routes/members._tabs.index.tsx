import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { ApprovedTab } from "#/features/members/components/approved-tab";
import type {
  MembersToolbarState,
  MemberSortKey,
} from "#/features/members/components/members-toolbar";
import { requireEnabledPages } from "#/features/settings/api/page-guards";
import { useToolbarSearchState } from "#/hooks/use-toolbar-search-state";

const approvedSearchSchema = z.object({
  q: z.string().optional(),
  affiliations: z.string().optional(), // comma-separated values
  roles: z.string().optional(), // comma-separated values
  sort: z.enum(["name", "created"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
  view: z.enum(["list", "grid"]).optional(),
});

/** Resolved on read, omitted on write. `dir` is absent on purpose — its
 *  default depends on the sort key, so it isn't a single constant. */
const SEARCH_DEFAULTS = {
  sort: "name",
  view: "list",
  page: 1,
  limit: 50,
} as const;

const DEFAULT_DIR: Record<MemberSortKey, "asc" | "desc"> = {
  name: "asc",
  created: "desc",
};

/** Sort, direction and view are deliberately absent: they reorder or
 *  redraw the same rows, so the current page still means something. */
const RESULT_SET_KEYS = ["q", "affiliations", "roles"] as const;

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
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const { value, set } = useToolbarSearchState({
    search,
    defaults: SEARCH_DEFAULTS,
    resultSetKeys: RESULT_SET_KEYS,
    navigate: (next) => void navigate({ search: next }),
  });

  const sort = value.sort ?? "name";
  const state: MembersToolbarState = {
    q: value.q ?? "",
    affiliations: value.affiliations?.split(",").filter(Boolean) ?? [],
    roles: value.roles?.split(",").filter(Boolean) ?? [],
    sort,
    dir: value.dir ?? DEFAULT_DIR[sort],
    view: value.view ?? "list",
  };

  return (
    <ApprovedTab
      state={state}
      onStateChange={(next) => {
        // The two multi-selects travel as comma-joined strings, which
        // is the one place the URL shape and the toolbar's shape
        // disagree.
        set({
          ...("q" in next ? { q: next.q } : {}),
          ...("affiliations" in next
            ? { affiliations: next.affiliations?.join(",") }
            : {}),
          ...("roles" in next ? { roles: next.roles?.join(",") } : {}),
          ...("sort" in next ? { sort: next.sort } : {}),
          ...("dir" in next ? { dir: next.dir } : {}),
          ...("view" in next ? { view: next.view } : {}),
        });
      }}
      perPage={value.limit ?? 50}
      page={value.page ?? 1}
      onPerPageChange={(limit) =>
        set({ limit: Number(limit), page: undefined })
      }
      onPageChange={(page) => set({ page })}
    />
  );
}
