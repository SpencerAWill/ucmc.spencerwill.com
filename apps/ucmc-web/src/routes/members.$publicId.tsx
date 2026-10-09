import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  LogOut,
  Pencil,
  RefreshCw,
  Shield,
  Undo2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useState } from "react";

import { PageContainer } from "#/components/layouts/page-container";
import { memberDetailQueryOptions } from "#/features/members/api/queries";
import { useDeactivateMembers } from "#/features/members/api/use-deactivate-members";
import { useReactivateMembers } from "#/features/members/api/use-reactivate-members";
import { useRevokeUserSessions } from "#/features/members/api/use-revoke-user-sessions";
import { useUnrejectMembers } from "#/features/members/api/use-unreject-members";
import { AdminProfileSheet } from "#/features/members/components/admin-profile-sheet";
import type { AdminProfileDefaults } from "#/features/members/components/admin-profile-sheet";
import { RoleAssignmentSheet } from "#/features/members/components/role-assignment-sheet";
import {
  ProfileDisciplines,
  ProfilePrompts,
} from "#/features/members/components/profile/profile-about";
import {
  BadgeCatalog,
  BadgeShowcase,
} from "#/features/members/components/profile/profile-badges";
import { ProfileHeader } from "#/features/members/components/profile/profile-header";
import { TopoBanner } from "#/features/members/components/profile/topo-banner";
import {
  FieldEmergencyCard,
  TripReadiness,
} from "#/features/members/components/profile/profile-officer-panel";
import type { ReadinessItem } from "#/features/members/components/profile/profile-officer-panel";
import { ProfileStats } from "#/features/members/components/profile/profile-stats";
import type { ProfileStat } from "#/features/members/components/profile/profile-stats";
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
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "#/components/ui/empty";
import { Skeleton } from "#/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { RouteErrorFallback } from "#/components/error-page";
import { formatDate } from "#/lib/date-format";
import {
  requireApproved,
  WAIVER_VIEW_PERMISSIONS,
} from "#/features/auth/guards";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePageFlag } from "#/features/settings/api/page-guards";
import type { MemberDetail } from "#/features/members/server/member-fns";

export const Route = createFileRoute("/members/$publicId")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "members_detail");
    await requireApproved(context.queryClient);
  },
  component: MemberDetailPage,
  errorComponent: RouteErrorFallback,
});

type ProfileTab = "overview" | "badges" | "officer";

function MemberDetailPage() {
  const { publicId } = Route.useParams();
  const { hasPermission, hasAnyPermission, principal } = useAuth();
  const [tab, setTab] = useState<ProfileTab>("overview");

  const {
    data: member,
    isLoading,
    error,
    refetch,
  } = useQuery(memberDetailQueryOptions(publicId));

  const canManage = hasPermission("members:manage");
  const canViewPrivate = hasPermission("members:view_private");
  const canRevokeSessions = hasPermission("sessions:revoke");
  const canAssignRoles = hasPermission("roles:assign");
  // Waiver standing is a permissioned read, so the card follows the
  // permission — NOT the mere presence of `member.waiverStatus` in the
  // payload. The two agree for a real viewer (the server omits the
  // field for anyone without the permission), but they diverge under
  // role emulation: a sys admin emulating `member` still gets the
  // field, because emulation is a UI-only filter over the real
  // principal. Reading the flag here is what makes the emulated view
  // honest.
  const canViewWaivers = hasAnyPermission(WAIVER_VIEW_PERMISSIONS);
  const isSelf = principal?.userId === member?.userId;

  // Everything an officer sees lives behind one tab. Taking the
  // waiver, contacts and admin cards out of the main column is what
  // stops the page reading as a personnel record.
  const hasOfficerTab =
    !isSelf &&
    (canViewPrivate ||
      canViewWaivers ||
      canManage ||
      canRevokeSessions ||
      canAssignRoles);

  if (isLoading) {
    return (
      <PageContainer width="app" className="space-y-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </PageContainer>
    );
  }

  // A failed read and a member who does not exist are different
  // answers and must not share a screen: "not found" sends a reader
  // looking for a deleted account when the query merely threw, and
  // an error screen offers a Retry that can never succeed for a
  // member who was never there. `getMemberDetailAction` answers
  // `null` for the second case and throws only for the first, which
  // is what makes the two distinguishable here.
  if (error) {
    return (
      <PageContainer width="app">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Couldn&rsquo;t load this member.</AlertTitle>
          <AlertDescription className="gap-3">
            {/* Deliberately not `error.message`. A server-fn error
                serializes its message to the client, so a D1 failure
                would print internal query text to any approved
                member. The retry is the useful half. */}
            <p>Something went wrong fetching this profile.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </PageContainer>
    );
  }

  if (!member) {
    return (
      <PageContainer width="app">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Member not found</EmptyTitle>
            <EmptyDescription>
              This profile may have been removed, or the link may be wrong.
            </EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" size="sm" asChild>
            <Link to="/members">Back to directory</Link>
          </Button>
        </Empty>
      </PageContainer>
    );
  }

  // `tab` is component state and `hasOfficerTab` follows live
  // permissions, so switching role emulation while sitting on the
  // Officer tab unmounts both its trigger and its panel and leaves
  // the controlled `Tabs` on a value nothing matches — a blank
  // content area. Clamping at render keeps the two in step without
  // an effect.
  const activeTab: ProfileTab =
    tab === "officer" && !hasOfficerTab ? "overview" : tab;

  const name = member.preferredName ?? member.fullName;
  const { stats } = member;

  // Only tiles with something behind them. A strip padded out with
  // zeros reads as a member who has done nothing, when the truth is
  // usually that the club has not recorded it yet.
  // A null tally means the viewer may not see it, which is not the
  // same as zero — both are dropped from the strip, but only one of
  // them would have been a claim.
  const tiles: ProfileStat[] = [
    { label: "Seasons", value: stats.completedSeasons },
    { label: "Badges", value: stats.badges.length },
    { label: "Gear loans", value: stats.gearLoans },
    { label: "Sweeps", value: stats.sweepsParticipated },
  ].flatMap((tile) =>
    tile.value !== null && tile.value > 0
      ? [{ label: tile.label, value: tile.value }]
      : [],
  );

  const readiness: ReadinessItem[] = [];
  if (canViewWaivers && member.waiverStatus) {
    readiness.push({
      state: member.waiverStatus.attested ? "ok" : "blocked",
      label: member.waiverStatus.attested
        ? `Waiver attested, cycle ${member.waiverStatus.cycle}`
        : `No current waiver for ${member.waiverStatus.cycle}`,
      detail: member.waiverStatus.attestedAt
        ? // Null when the attesting officer has since deleted their
          // account (the FK is SET NULL).
          `${formatDate(member.waiverStatus.attestedAt)} · ${member.waiverStatus.attestedByName ?? "(deleted user)"}`
        : null,
    });
  }
  if (canViewPrivate) {
    readiness.push({
      state: member.emergencyContacts.length > 0 ? "ok" : "warn",
      label:
        member.emergencyContacts.length > 0
          ? `${member.emergencyContacts.length} emergency contact${member.emergencyContacts.length > 1 ? "s" : ""} on file`
          : "No emergency contact on file",
    });
  }
  // Only for a viewer who may see the tallies at all; the Officer
  // tab is already permission-gated, but the payload is the gate
  // that matters.
  if (stats.openLoans !== null) {
    readiness.push({
      state: stats.openLoans > 0 ? "warn" : "ok",
      label:
        stats.openLoans > 0
          ? `Holding ${stats.openLoans} item${stats.openLoans > 1 ? "s" : ""} from the gear cave`
          : "Nothing out from the gear cave",
    });
  }

  return (
    // Not wrapped in one `PageContainer`: the banner runs the full
    // width of the viewport, so it sits outside the container and
    // everything else sits inside one. A negative margin would have
    // to track the container's gutter at every breakpoint instead,
    // which is the overflow bug `mobile-overflow.spec.ts` guards.
    <div className="pb-8">
      {/* The back link rides on the banner rather than on a strip
          above it: a band of page background over a full-bleed image
          reads as a letterboxing bug, and the contour green gives
          the link plenty of contrast to sit on. */}
      <div className="relative">
        <TopoBanner seed={member.publicId} />
        <div className="absolute inset-x-0 top-0">
          <PageContainer width="app" className="py-2 sm:py-3">
            <Link
              to="/members"
              className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-[var(--header-foreground)]/85 transition-colors hover:text-[var(--header-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--header-foreground)] focus-visible:outline-none"
            >
              <ArrowLeft className="size-4" />
              Back to directory
            </Link>
          </PageContainer>
        </div>
      </div>

      <PageContainer width="app" className="space-y-4 py-0">
        <ProfileHeader
          name={name}
          fullName={member.fullName}
          preferredName={member.preferredName}
          trailName={member.trailName}
          pronouns={member.pronouns}
          statusLine={member.statusLine}
          email={member.email}
          avatarKey={member.avatarKey}
          status={member.status}
          ucAffiliation={member.ucAffiliation}
          roles={member.roles}
          completedSeasons={stats.completedSeasons}
          seasonProgress={stats.seasonProgress}
          actions={
            isSelf ? (
              <Button variant="outline" size="sm" asChild>
                <Link to="/my/profile">
                  <Pencil className="mr-1 size-3.5" />
                  Edit profile
                </Link>
              </Button>
            ) : null
          }
        />

        <ProfileStats stats={tiles} />

        <Tabs
          value={activeTab}
          onValueChange={(value) => setTab(value as ProfileTab)}
        >
          {/* Scrolls rather than wraps at phone width: a wrapped tab
            list changes height between tabs and shifts the content
            under the reader's thumb. */}
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="badges">Badges</TabsTrigger>
            {hasOfficerTab ? (
              <TabsTrigger value="officer">Officer</TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <ProfilePrompts
              prompts={member.prompts}
              bio={member.bio}
              isSelf={isSelf}
            />
            <ProfileDisciplines
              disciplines={member.disciplines}
              isSelf={isSelf}
            />
            <BadgeShowcase
              badges={stats.badges}
              onSeeAll={() => setTab("badges")}
            />
          </TabsContent>

          <TabsContent value="badges" className="space-y-4">
            <BadgeCatalog badges={stats.badges} />
          </TabsContent>

          {hasOfficerTab ? (
            <TabsContent value="officer" className="space-y-4">
              <TripReadiness items={readiness} />

              {canViewPrivate ? (
                <FieldEmergencyCard
                  phone={member.phone}
                  contacts={member.emergencyContacts}
                />
              ) : null}

              {canViewWaivers && member.waiverStatus ? (
                <Card>
                  <CardContent className="space-y-2">
                    <h2 className="text-sm font-semibold">Waiver</h2>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {member.waiverStatus.attested ? (
                        <Badge variant="success">Attested</Badge>
                      ) : (
                        <Badge variant="destructive">
                          No current attestation
                        </Badge>
                      )}
                      <span className="text-muted-foreground">
                        cycle {member.waiverStatus.cycle}
                      </span>
                      <code className="text-xs text-muted-foreground">
                        {member.waiverStatus.version}
                      </code>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {canManage || canRevokeSessions || canAssignRoles ? (
                <Card>
                  <CardContent className="space-y-3">
                    <h2 className="text-sm font-semibold">Actions</h2>
                    <div className="flex flex-wrap gap-2">
                      {canManage ? (
                        <MemberManageActions
                          member={member}
                          publicId={publicId}
                        />
                      ) : null}
                      {canRevokeSessions &&
                      member.activeSessions !== null &&
                      member.activeSessions > 0 ? (
                        <RevokeSessionsButton
                          member={member}
                          publicId={publicId}
                        />
                      ) : null}
                      {canAssignRoles ? (
                        <RoleAssignButton member={member} />
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>
          ) : null}
        </Tabs>
      </PageContainer>
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
          trailName: member.trailName,
          pronouns: member.pronouns,
          statusLine: member.statusLine,
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
          onClick={() =>
            reactivate.mutate([member.userId], {
              onSuccess: () => toast.success("Account reactivated"),
              onError: (err) =>
                toast.error(err.message || "Couldn’t reactivate that account."),
            })
          }
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
          onClick={() =>
            unreject.mutate([member.userId], {
              onSuccess: () => toast.success("Moved back to pending"),
              onError: (err) =>
                toast.error(
                  err.message || "Couldn’t move that registration back.",
                ),
            })
          }
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
              variant="destructive"
              onClick={() =>
                deactivate.mutate([member.userId], {
                  onSuccess: () => {
                    setConfirmAction(null);
                    toast.success("Account deactivated");
                  },
                  // The dialog closing on success was the only signal,
                  // so a *failure* left it open with no explanation —
                  // which reads as an unresponsive button.
                  onError: (err) =>
                    toast.error(
                      err.message || "Couldn’t deactivate that account.",
                    ),
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
              variant="destructive"
              onClick={() =>
                revoke.mutate(member.userId, {
                  onSuccess: () => {
                    setOpen(false);
                    toast.success("Signed out of every device");
                  },
                  // A silent failure here is the dangerous one: the
                  // officer has just been told the account is signed
                  // out everywhere, and acts on that, when it isn't.
                  onError: (err) =>
                    toast.error(
                      err.message || "Couldn’t revoke those sessions.",
                    ),
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
