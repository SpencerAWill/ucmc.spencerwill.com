/**
 * The approved-members directory: search-by-filters (affiliation +
 * role), sort, list/grid view, pagination, optional role-assignment
 * affordance for officers. URL state is owned by the calling route and
 * threaded through props — this component is purely controlled.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Filter,
  LayoutGrid,
  List,
  Search,
  Shield,
  User as UserIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { DataPagination } from "#/components/data-pagination";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
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
import { UserAvatar } from "#/components/user-avatar";
import { useAuth } from "#/features/auth/api/use-auth";
import {
  membersDirectoryQueryOptions,
  rolesQueryOptions,
} from "#/features/members/api/queries";
import { RoleAssignmentSheet } from "#/features/members/components/role-assignment-sheet";
import type {
  MemberSummary,
  RoleOption,
} from "#/features/members/server/member-fns";

const LIMIT_OPTIONS = ["25", "50", "100", "250"] as const;

export type ApprovedViewMode = "list" | "grid";

const AFFILIATION_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "faculty", label: "Faculty" },
  { value: "staff", label: "Staff" },
  { value: "alum", label: "Alum" },
  { value: "community", label: "Community" },
] as const;

const SORT_OPTIONS = [
  { value: "name_asc", label: "Name (A–Z)" },
  { value: "name_desc", label: "Name (Z–A)" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
] as const;

export type ApprovedSortOption = (typeof SORT_OPTIONS)[number]["value"];

export interface ApprovedTabProps {
  search: string | undefined;
  affiliations: string[];
  roles: string[];
  sort: ApprovedSortOption;
  perPage: number;
  page: number;
  view: ApprovedViewMode;
  onAffiliationsChange: (next: string[]) => void;
  onRolesChange: (next: string[]) => void;
  onSortChange: (sort: ApprovedSortOption) => void;
  onPerPageChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onViewChange: (view: ApprovedViewMode) => void;
  onClearFilters: () => void;
}

export function ApprovedTab({
  search,
  affiliations,
  roles,
  sort,
  perPage,
  page,
  view,
  onAffiliationsChange,
  onRolesChange,
  onSortChange,
  onPerPageChange,
  onPageChange,
  onViewChange,
  onClearFilters,
}: ApprovedTabProps) {
  const offset = (page - 1) * perPage;

  const toggleAffiliation = (value: string) => {
    onAffiliationsChange(
      affiliations.includes(value)
        ? affiliations.filter((a) => a !== value)
        : [...affiliations, value],
    );
  };

  const toggleRole = (value: string) => {
    onRolesChange(
      roles.includes(value)
        ? roles.filter((r) => r !== value)
        : [...roles, value],
    );
  };

  const activeFilterCount = affiliations.length + roles.length;

  const { data: roleOptions = [] } = useQuery({
    ...rolesQueryOptions(),
    staleTime: 5 * 60 * 1000, // roles rarely change
  });

  const { data, isLoading } = useQuery(
    membersDirectoryQueryOptions({
      search,
      affiliations:
        affiliations.length > 0 ? affiliations.join(",") : undefined,
      roles: roles.length > 0 ? roles.join(",") : undefined,
      sort,
      limit: perPage,
      offset,
    }),
  );

  const { hasPermission } = useAuth();
  const canAssignRoles = hasPermission("roles:assign");

  const [roleTarget, setRoleTarget] = useState<MemberSummary | null>(null);

  const members = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="flex flex-col gap-6">
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
                onClick={() => onViewChange("list")}
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
                onClick={() => onViewChange("grid")}
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
                onClick={onClearFilters}
              >
                Clear all filters
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>

        {/* Sort */}
        <Select
          value={sort}
          onValueChange={(value) => onSortChange(value as ApprovedSortOption)}
        >
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
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {search
                ? "No members match your search."
                : "No approved members yet."}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
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

          <DataPagination
            page={page}
            totalPages={totalPages}
            total={total}
            perPage={perPage}
            perPageOptions={LIMIT_OPTIONS}
            onPageChange={onPageChange}
            onPerPageChange={onPerPageChange}
          />
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
      <Link
        to="/members/$publicId"
        params={{ publicId: member.publicId }}
        className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
      >
        <UserAvatar
          avatarKey={member.avatarKey}
          name={name}
          className="size-9 shrink-0"
          fallback={name ? undefined : <UserIcon className="size-4" />}
        />
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
      </Link>
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
    <Link to="/members/$publicId" params={{ publicId: member.publicId }}>
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="flex flex-col items-center gap-3 text-center">
          <UserAvatar
            avatarKey={member.avatarKey}
            name={name}
            className="size-12"
            fallbackClassName="text-lg"
            fallback={name ? undefined : <UserIcon className="size-5" />}
          />
          {name ? <p className="truncate text-sm font-medium">{name}</p> : null}
          <p className="truncate text-xs text-muted-foreground">
            {member.email}
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            <AffiliationBadge affiliation={member.ucAffiliation} />
            <RoleBadges roles={member.roles} />
          </div>
          {canAssignRoles ? (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                onManageRoles(member);
              }}
            >
              <Shield className="mr-1 size-3" />
              Roles
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
