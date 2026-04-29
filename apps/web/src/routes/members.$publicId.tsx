import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  LogOut,
  Pencil,
  Shield,
  Undo2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { Fragment, useState } from "react";

import { memberDetailQueryOptions } from "#/features/members/api/queries";
import { useDeactivateMembers } from "#/features/members/api/use-deactivate-members";
import { useReactivateMembers } from "#/features/members/api/use-reactivate-members";
import { useRevokeUserSessions } from "#/features/members/api/use-revoke-user-sessions";
import { useUnrejectMembers } from "#/features/members/api/use-unreject-members";
import { AdminProfileSheet } from "#/features/members/components/admin-profile-sheet";
import type { AdminProfileDefaults } from "#/features/members/components/admin-profile-sheet";
import { RoleAssignmentSheet } from "#/features/members/components/role-assignment-sheet";
import { StatusBadge } from "#/features/members/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { UserAvatar } from "#/components/user-avatar";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Separator } from "#/components/ui/separator";
import { RouteErrorFallback } from "#/components/error-page";
import { requireApproved } from "#/features/auth/guards";
import { useAuth } from "#/features/auth/api/use-auth";
import type { MemberDetail } from "#/features/members/server/member-fns";

export const Route = createFileRoute("/members/$publicId")({
  beforeLoad: async ({ context }) => {
    await requireApproved(context.queryClient);
  },
  component: MemberDetailPage,
  errorComponent: RouteErrorFallback,
});

function MemberDetailPage() {
  const { publicId } = Route.useParams();
  const { hasPermission, principal } = useAuth();

  const { data: member, isLoading } = useQuery(
    memberDetailQueryOptions(publicId),
  );

  const canManage = hasPermission("members:manage");
  const canViewPrivate = hasPermission("members:view_private");
  const canRevokeSessions = hasPermission("sessions:revoke");
  const canAssignRoles = hasPermission("roles:assign");
  const isSelf = principal?.userId === member?.userId;

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!member) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Member not found.
      </div>
    );
  }

  const name = member.preferredName ?? member.fullName;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        to="/members"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to directory
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4">
        <UserAvatar
          avatarKey={member.avatarKey}
          name={name}
          className="size-16"
          fallbackClassName="text-lg"
        />
        <div className="min-w-0 flex-1 space-y-1">
          {name ? (
            <h1 className="truncate text-xl font-semibold">{name}</h1>
          ) : null}
          {member.fullName && member.preferredName ? (
            <p className="truncate text-sm text-muted-foreground">
              {member.fullName}
            </p>
          ) : null}
          <p className="truncate text-sm text-muted-foreground">
            {member.email}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <StatusBadge status={member.status} />
            {member.ucAffiliation ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs capitalize">
                {member.ucAffiliation}
              </span>
            ) : null}
            {member.roles
              .filter((r) => r !== "member")
              .map((role) => (
                <span
                  key={role}
                  className="rounded bg-primary/10 px-1.5 py-0.5 text-xs capitalize text-primary"
                >
                  {role.replace(/_/g, " ")}
                </span>
              ))}
          </div>
        </div>
      </div>

      <Separator />

      {/* Public profile */}
      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-semibold">Public profile</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {member.preferredName ? (
              <>
                <dt className="text-muted-foreground">Preferred name</dt>
                <dd>{member.preferredName}</dd>
              </>
            ) : null}
            {member.ucAffiliation ? (
              <>
                <dt className="text-muted-foreground">UC affiliation</dt>
                <dd className="capitalize">{member.ucAffiliation}</dd>
              </>
            ) : null}
          </dl>
          {member.bio ? (
            <p className="whitespace-pre-line pt-2 text-sm">{member.bio}</p>
          ) : (
            <p className="pt-2 text-sm italic text-muted-foreground">
              No bio yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Private information */}
      {canViewPrivate ? (
        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-sm font-semibold">Private information</h2>
            {member.phone || member.emergencyContacts.length > 0 ? (
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {member.phone ? (
                  <>
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd>{member.phone}</dd>
                  </>
                ) : null}
                {member.emergencyContacts.map((ec, i) => (
                  <Fragment key={i}>
                    <dt className="text-muted-foreground">
                      Emergency contact
                      {member.emergencyContacts.length > 1 ? ` ${i + 1}` : ""}
                    </dt>
                    <dd>
                      {ec.name} ({ec.phone})
                      <span className="ml-1 text-xs text-muted-foreground">
                        — {ec.relationship.replace(/_/g, " ")}
                      </span>
                    </dd>
                  </Fragment>
                ))}
              </dl>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                No private information on file.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Admin actions */}
      {!isSelf && (canManage || canRevokeSessions || canAssignRoles) ? (
        <Card>
          <CardContent className="space-y-4">
            <h2 className="text-sm font-semibold">Actions</h2>
            <div className="flex flex-wrap gap-2">
              {canManage ? (
                <MemberManageActions member={member} publicId={publicId} />
              ) : null}
              {canRevokeSessions &&
              member.activeSessions !== null &&
              member.activeSessions > 0 ? (
                <RevokeSessionsButton member={member} publicId={publicId} />
              ) : null}
              {canAssignRoles ? <RoleAssignButton member={member} /> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ── Action sub-components ───────────────────────────────────────────────

function MemberManageActions({
  member,
  publicId,
}: {
  member: MemberDetail;
  publicId: string;
}) {
  const [confirmAction, setConfirmAction] = useState<
    "deactivate" | "profileEdit" | null
  >(null);

  const deactivate = useDeactivateMembers(publicId);
  const reactivate = useReactivateMembers(publicId);
  const unreject = useUnrejectMembers(publicId);

  const profileDefaults: AdminProfileDefaults | null =
    member.fullName !== null
      ? {
          fullName: member.fullName,
          preferredName: member.preferredName,
          phone: member.phone,
          emergencyContacts: member.emergencyContacts,
          ucAffiliation:
            member.ucAffiliation as AdminProfileDefaults["ucAffiliation"],
          bio: member.bio,
        }
      : null;

  const name = member.preferredName ?? member.email;

  return (
    <>
      {member.status === "approved" ? (
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10"
          onClick={() => setConfirmAction("deactivate")}
        >
          <UserMinus className="mr-1 size-3.5" />
          Deactivate
        </Button>
      ) : null}

      {member.status === "deactivated" ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => reactivate.mutate([member.userId])}
          disabled={reactivate.isPending}
        >
          <UserPlus className="mr-1 size-3.5" />
          {reactivate.isPending ? "Reactivating..." : "Reactivate"}
        </Button>
      ) : null}

      {member.status === "rejected" ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => unreject.mutate([member.userId])}
          disabled={unreject.isPending}
        >
          <Undo2 className="mr-1 size-3.5" />
          {unreject.isPending ? "Moving..." : "Move to Pending"}
        </Button>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        onClick={() => setConfirmAction("profileEdit")}
      >
        <Pencil className="mr-1 size-3.5" />
        Edit Profile
      </Button>

      {/* Deactivate confirmation */}
      <AlertDialog
        open={confirmAction === "deactivate"}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately sign them out and prevent them from
              accessing the site. You can reactivate their account later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deactivate.mutate([member.userId], {
                  onSuccess: () => setConfirmAction(null),
                })
              }
              disabled={deactivate.isPending}
            >
              {deactivate.isPending ? "Deactivating..." : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Admin profile edit sheet */}
      <AdminProfileSheet
        userId={member.userId}
        email={member.email}
        defaults={profileDefaults}
        open={confirmAction === "profileEdit"}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmAction(null);
          }
        }}
        detailPublicId={publicId}
      />
    </>
  );
}

function RevokeSessionsButton({
  member,
  publicId,
}: {
  member: MemberDetail;
  publicId: string;
}) {
  const [open, setOpen] = useState(false);
  const revoke = useRevokeUserSessions(publicId);

  const name = member.preferredName ?? member.email;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:bg-destructive/10"
        onClick={() => setOpen(true)}
      >
        <LogOut className="mr-1 size-3.5" />
        Force Sign Out
        {member.activeSessions !== null ? (
          <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] font-semibold">
            {member.activeSessions}
          </span>
        ) : null}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force sign out {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke all of {name}&rsquo;s active
              sessions. They will need to sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                revoke.mutate(member.userId, {
                  onSuccess: () => setOpen(false),
                })
              }
              disabled={revoke.isPending}
            >
              {revoke.isPending ? "Revoking..." : "Force Sign Out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RoleAssignButton({ member }: { member: MemberDetail }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Shield className="mr-1 size-3.5" />
        Manage Roles
      </Button>
      <RoleAssignmentSheet
        userId={member.userId}
        email={member.email}
        preferredName={member.preferredName}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
