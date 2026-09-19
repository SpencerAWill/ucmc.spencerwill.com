/**
 * The approved-members directory: the shared `<DataToolbar />` over a
 * list or grid of member cards, with pagination and an optional
 * role-assignment affordance for officers. URL state is owned by the
 * calling route and threaded through props — this component is purely
 * controlled.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Shield, User as UserIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { DataPagination } from "#/components/data-pagination";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { UserAvatar } from "#/components/user-avatar";
import { useAuth } from "#/features/auth/api/use-auth";
import { membersDirectoryQueryOptions } from "#/features/members/api/queries";
import { MembersToolbar } from "#/features/members/components/members-toolbar";
import type { MembersToolbarState } from "#/features/members/components/members-toolbar";
import { RoleAssignmentSheet } from "#/features/members/components/role-assignment-sheet";
import type {
  MemberRoleBadge,
  MemberSummary,
} from "#/features/members/server/member-fns";

const LIMIT_OPTIONS = ["25", "50", "100", "250"] as const;

export interface ApprovedTabProps {
  state: MembersToolbarState;
  onStateChange: (next: Partial<MembersToolbarState>) => void;
  perPage: number;
  page: number;
  onPerPageChange: (value: string) => void;
  onPageChange: (page: number) => void;
}

export function ApprovedTab({
  state,
  onStateChange,
  perPage,
  page,
  onPerPageChange,
  onPageChange,
}: ApprovedTabProps) {
  const offset = (page - 1) * perPage;

  const { data, isLoading } = useQuery(
    membersDirectoryQueryOptions({
      search: state.q.length > 0 ? state.q : undefined,
      affiliations:
        state.affiliations.length > 0
          ? state.affiliations.join(",")
          : undefined,
      roles: state.roles.length > 0 ? state.roles.join(",") : undefined,
      sort: state.sort,
      dir: state.dir,
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
      <MembersToolbar state={state} onChange={onStateChange} />

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : members.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {state.q.length > 0 ||
              state.affiliations.length > 0 ||
              state.roles.length > 0
                ? "No members match your search."
                : "No approved members yet."}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {state.view === "list" ? (
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

/**
 * Role chips for a directory row. Renders `displayName` — the label an
 * operator typed at /access — and filters on the `name` slug, which is
 * the half that's stable enough to compare against.
 *
 * No `capitalize` here: the label already carries its intended casing,
 * and the CSS transform would uppercase every word ("VP of Trips" →
 * "VP Of Trips").
 */
function RoleBadges({ roles }: { roles: MemberRoleBadge[] }) {
  return (
    <>
      {roles
        .filter((r) => r.name !== "member")
        .map((role) => (
          <span
            key={role.name}
            className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
          >
            {role.displayName}
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
