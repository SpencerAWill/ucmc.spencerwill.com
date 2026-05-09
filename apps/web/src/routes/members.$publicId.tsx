import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  LogOut,
  Pencil,
  Shield,
  Undo2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { Fragment, useState } from "react";

import { memberDetailQueryOptions } from "#/features/members/api/queries";
import { useBanMembers } from "#/features/members/api/use-ban-members";
import { useDeactivateMembers } from "#/features/members/api/use-deactivate-members";
import { useReactivateMembers } from "#/features/members/api/use-reactivate-members";
import { useRevokeUserSessions } from "#/features/members/api/use-revoke-user-sessions";
import { useUnbanMembers } from "#/features/members/api/use-unban-members";
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
import { Label } from "#/components/ui/label";
import { Separator } from "#/components/ui/separator";
import { Textarea } from "#/components/ui/textarea";
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
  const canBan = hasPermission("members:ban");
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
      {!isSelf &&
      (canManage || canBan || canRevokeSessions || canAssignRoles) ? (
        <Card>
          <CardContent className="space-y-4">
            <h2 className="text-sm font-semibold">Actions</h2>
            <div className="flex flex-wrap gap-2">
              {canManage ? (
                <MemberManageActions member={member} publicId={publicId} />
              ) : null}
              {canBan ? (
                <MemberBanActions member={member} publicId={publicId} />
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

// ── Ban / Unban ─────────────────────────────────────────────────────────

const BAN_REASON_MIN = 10;
const BAN_REASON_MAX = 2000;

function MemberBanActions({
  member,
  publicId,
}: {
  member: MemberDetail;
  publicId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ban = useBanMembers(publicId);
  const unban = useUnbanMembers(publicId);
  const name = member.preferredName ?? member.email;

  // Mirror the server-side trim+min-length floor so the disabled state
  // matches what the action will accept. Whitespace-only input must
  // not satisfy the gate.
  const trimmedReason = reason.trim();
  const reasonValid =
    trimmedReason.length >= BAN_REASON_MIN &&
    trimmedReason.length <= BAN_REASON_MAX;

  if (member.status === "banned") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => unban.mutate([member.userId])}
        disabled={unban.isPending}
      >
        <UserPlus className="mr-1 size-3.5" />
        {unban.isPending ? "Unbanning..." : "Unban"}
      </Button>
    );
  }

  // The detail page narrows status to `DirectoryStatus`
  // (`unclaimed` is filtered out at the action layer), so every
  // remaining state — pending, approved, rejected, deactivated — is
  // a valid ban target. The bulk action has the same allowlist on
  // the server side.

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive hover:bg-destructive/10"
        onClick={() => setOpen(true)}
      >
        <Ban className="mr-1 size-3.5" />
        Ban
      </Button>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            // Clear the reason on close so re-opening doesn't carry
            // a draft from a prior cancel into a different action.
            setReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All of their email addresses are added to the blocklist
              independently of the user row, so the addresses stay blocked even
              if the account is later deleted. You can unban from the Banned tab
              in member management.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ban-reason">Reason</Label>
            <Textarea
              id="ban-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={BAN_REASON_MAX}
              placeholder="What policy violation prompted this ban? Captured on the audit row."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Minimum {BAN_REASON_MIN} characters. Recorded on the audit event
              metadata; do not include third-party PII.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                ban.mutate(
                  { userIds: [member.userId], reason: trimmedReason },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      setReason("");
                    },
                  },
                )
              }
              disabled={ban.isPending || !reasonValid}
            >
              {ban.isPending ? "Banning..." : "Ban"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
