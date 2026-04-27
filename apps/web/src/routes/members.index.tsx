import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  LayoutGrid,
  List,
  Search,
  Shield,
  User as UserIcon,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { RoleAssignmentSheet } from "#/components/auth/role-assignment-sheet";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { requireApproved } from "#/lib/auth/guards";
import { useAuth } from "#/lib/auth/use-auth";
import { listMembersFn, listRolesFn } from "#/server/auth/member-fns";
import type { MemberSummary, RoleOption } from "#/server/auth/member-fns";

const MEMBERS_QUERY_KEY = ["members", "directory"] as const;
const LIMIT_OPTIONS = ["25", "50", "100", "250"] as const;

type ViewMode = "list" | "grid";

const AFFILIATION_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "faculty", label: "Faculty" },
  { value: "staff", label: "Staff" },
  { value: "alum", label: "Alum" },
  { value: "community", label: "Community" },
] as const;

const ROLES_QUERY_KEY = ["members", "roles"] as const;

const SORT_OPTIONS = [
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "name_desc", label: "Name (Z–A)" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
] as const;

type SortOption = (typeof SORT_OPTIONS)[number]["value"];

const membersSearchSchema = z.object({
  q: z.string().optional(),
  affiliations: z.string().optional(), // comma-separated values
  roles: z.string().optional(), // comma-separated values
  sort: z.enum(["name_asc", "name_desc", "newest", "oldest"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
  view: z.enum(["list", "grid"]).optional(),
});

export const Route = createFileRoute("/members/")({
  validateSearch: membersSearchSchema,
  beforeLoad: async ({ context }) => {
    await requireApproved(context.queryClient);
  },
  component: MembersIndexPage,
});

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase()
  );
}

function MembersIndexPage() {
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
  const offset = (page - 1) * perPage;
  const [view, setViewState] = useState<ViewMode>(searchView ?? "list");

  const affiliations = affiliationsParam?.split(",").filter(Boolean) ?? [];
  const roles = rolesParam?.split(",").filter(Boolean) ?? [];

  const updateSearch = (
    updates: Partial<{
      q: string | undefined;
      affiliations: string | undefined;
      roles: string | undefined;
      sort: SortOption | undefined;
      limit: number | undefined;
      page: number | undefined;
      view: ViewMode | undefined;
    }>,
  ) => {
    void navigate({
      search: (prev) => ({ ...prev, ...updates }),
    });
  };

  // TODO: uncomment when server-side search (LIKE query) is wired up.
  // const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // const setSearch = useCallback(
  //   (value: string) => {
  //     if (searchTimer.current) {
  //       clearTimeout(searchTimer.current);
  //     }
  //     searchTimer.current = setTimeout(() => {
  //       updateSearch({ q: value || undefined, page: undefined });
  //     }, 300);
  //   },
  //   [],
  // );

  const setPage = (p: number) =>
    updateSearch({ page: p === 1 ? undefined : p });

  const setView = (mode: ViewMode) => {
    setViewState(mode);
    updateSearch({ view: mode === "list" ? undefined : mode });
  };

  const setLimit = (value: string) =>
    updateSearch({ limit: Number(value), page: undefined });

  const setSort = (value: string) =>
    updateSearch({
      sort: value === "name_asc" ? undefined : (value as SortOption),
      page: undefined,
    });

  const toggleAffiliation = (value: string) => {
    const next = affiliations.includes(value)
      ? affiliations.filter((a) => a !== value)
      : [...affiliations, value];
    updateSearch({
      affiliations: next.length > 0 ? next.join(",") : undefined,
      page: undefined,
    });
  };

  const toggleRole = (value: string) => {
    const next = roles.includes(value)
      ? roles.filter((r) => r !== value)
      : [...roles, value];
    updateSearch({
      roles: next.length > 0 ? next.join(",") : undefined,
      page: undefined,
    });
  };

  const activeFilterCount = affiliations.length + roles.length;

  const queryKey = [
    ...MEMBERS_QUERY_KEY,
    search,
    affiliationsParam,
    rolesParam,
    sort,
    perPage,
    page,
  ];

  const { data: roleOptions = [] } = useQuery({
    queryKey: ROLES_QUERY_KEY,
    queryFn: () => listRolesFn(),
    staleTime: 5 * 60 * 1000, // roles rarely change
  });

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      listMembersFn({
        data: {
          search,
          affiliations: affiliationsParam,
          roles: rolesParam,
          sort: sort ?? "name_asc",
          limit: perPage,
          offset,
        },
      }),
  });

  const { hasPermission } = useAuth();
  const canAssignRoles = hasPermission("roles:assign");

  const [roleTarget, setRoleTarget] = useState<MemberSummary | null>(null);

  const members = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="text-sm text-muted-foreground">Approved club members.</p>
      </header>

      {/* Row 1: Search + view toggle */}
      {/* TODO: wire search to LIKE query in listMembersAction */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search coming soon…" className="pl-9" disabled />
        </div>
        <div className="flex h-9 rounded-md border">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={view === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-full w-9 rounded-r-none"
                onClick={() => setView("list")}
              >
                <List className="size-4" />
                <span className="sr-only">List view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>List view</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={view === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-full w-9 rounded-l-none"
                onClick={() => setView("grid")}
              >
                <LayoutGrid className="size-4" />
                <span className="sr-only">Grid view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Grid view</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Row 2: Filters + sort */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Filters popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="h-9">
              <Filter className="mr-2 size-4" />
              Filters
              {activeFilterCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-4" align="start">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Affiliation
              </Label>
              {AFFILIATION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={affiliations.includes(opt.value)}
                    onCheckedChange={() => toggleAffiliation(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Role
              </Label>
              {roleOptions.map((role: RoleOption) => (
                <label
                  key={role.name}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    checked={roles.includes(role.name)}
                    onCheckedChange={() => toggleRole(role.name)}
                  />
                  <span className="capitalize">
                    {role.name.replace(/_/g, " ")}
                  </span>
                </label>
              ))}
            </div>
            {activeFilterCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() =>
                  updateSearch({
                    affiliations: undefined,
                    roles: undefined,
                    page: undefined,
                  })
                }
              >
                Clear all filters
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>

        {/* Sort */}
        <Select value={sort ?? "name_asc"} onValueChange={setSort}>
          <SelectTrigger className="w-[9rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {search
            ? "No members match your search."
            : "No approved members yet."}
        </div>
      ) : (
        <>
          {view === "list" ? (
            <MemberListView
              members={members}
              canAssignRoles={canAssignRoles}
              onManageRoles={setRoleTarget}
            />
          ) : (
            <MemberGridView
              members={members}
              canAssignRoles={canAssignRoles}
              onManageRoles={setRoleTarget}
            />
          )}

          {/* Pagination + rows per page */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
                <span className="ml-1 hidden sm:inline">({total} total)</span>
              </span>
              <Select value={String(perPage)} onValueChange={setLimit}>
                <SelectTrigger className="h-8 w-[7rem] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMIT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="size-4" />
                <span className="sr-only">Previous page</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight className="size-4" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Role assignment sheet */}
      {roleTarget ? (
        <RoleAssignmentSheet
          userId={roleTarget.userId}
          email={roleTarget.email}
          preferredName={roleTarget.preferredName}
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setRoleTarget(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────

function RoleBadges({ roles }: { roles: string[] }) {
  const display = roles
    .filter((r) => r !== "member")
    .map((r) => r.replace("_", " "));
  return (
    <>
      {display.map((role) => (
        <span
          key={role}
          className="rounded bg-primary/10 px-1.5 py-0.5 text-xs capitalize text-primary"
        >
          {role}
        </span>
      ))}
    </>
  );
}

function AffiliationBadge({ affiliation }: { affiliation: string | null }) {
  if (!affiliation) {
    return null;
  }
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs capitalize">
      {affiliation}
    </span>
  );
}

// ── List view ─────────────────────────────────────────────────────────────

function MemberListView({
  members,
  canAssignRoles,
  onManageRoles,
}: {
  members: MemberSummary[];
  canAssignRoles: boolean;
  onManageRoles: (member: MemberSummary) => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {members.map((member) => (
        <MemberRow
          key={member.userId}
          member={member}
          canAssignRoles={canAssignRoles}
          onManageRoles={onManageRoles}
        />
      ))}
    </ul>
  );
}

function MemberRow({
  member,
  canAssignRoles,
  onManageRoles,
}: {
  member: MemberSummary;
  canAssignRoles: boolean;
  onManageRoles: (member: MemberSummary) => void;
}) {
  const name = member.preferredName ?? member.fullName;
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <Avatar className="size-9 shrink-0">
        <AvatarFallback>
          {name ? initialsFor(name) : <UserIcon className="size-4" />}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
          {name ? (
            <span className="truncate text-sm font-medium">{name}</span>
          ) : null}
          <span className="truncate text-sm text-muted-foreground">
            {member.email}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <AffiliationBadge affiliation={member.ucAffiliation} />
          <RoleBadges roles={member.roles} />
        </div>
      </div>
      {canAssignRoles ? (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => onManageRoles(member)}
        >
          <Shield className="size-4" />
          <span className="sr-only">Manage roles</span>
        </Button>
      ) : null}
    </li>
  );
}

// ── Grid / card view ──────────────────────────────────────────────────────

function MemberGridView({
  members,
  canAssignRoles,
  onManageRoles,
}: {
  members: MemberSummary[];
  canAssignRoles: boolean;
  onManageRoles: (member: MemberSummary) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {members.map((member) => (
        <MemberCard
          key={member.userId}
          member={member}
          canAssignRoles={canAssignRoles}
          onManageRoles={onManageRoles}
        />
      ))}
    </div>
  );
}

function MemberCard({
  member,
  canAssignRoles,
  onManageRoles,
}: {
  member: MemberSummary;
  canAssignRoles: boolean;
  onManageRoles: (member: MemberSummary) => void;
}) {
  const name = member.preferredName ?? member.fullName;
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
        <Avatar className="size-12">
          <AvatarFallback className="text-lg">
            {name ? initialsFor(name) : <UserIcon className="size-5" />}
          </AvatarFallback>
        </Avatar>
        {name ? <p className="truncate text-sm font-medium">{name}</p> : null}
        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          <AffiliationBadge affiliation={member.ucAffiliation} />
          <RoleBadges roles={member.roles} />
        </div>
        {canAssignRoles ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onManageRoles(member)}
          >
            <Shield className="mr-1 size-3" />
            Roles
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
