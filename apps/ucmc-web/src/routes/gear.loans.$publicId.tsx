import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, Inbox, PackageX } from "lucide-react";
import { useState } from "react";

import { PageContainer } from "#/components/layouts/page-container";
import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";
import { requirePermission } from "#/features/auth/guards";
import { loanDetailQueryOptions } from "#/features/gear/api/queries";
import { GearDeskTrigger } from "#/features/gear/components/gear-desk-trigger";
import { LoanDetailCard } from "#/features/gear/components/loan-detail-card";
import { LoanExtendDialog } from "#/features/gear/components/loan-extend-dialog";
import { LoanWriteOffDialog } from "#/features/gear/components/loan-write-off-dialog";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

export const Route = createFileRoute("/gear/loans/$publicId")({
  staticData: { pageFlag: "gear_loans_detail" },
  beforeLoad: async ({ context, matches }) => {
    await requireEnabledPages(context.queryClient, matches);
    await requirePermission(context.queryClient, "gear:loan");
  },
  component: LoanDetailPage,
});

function LoanDetailPage() {
  const { publicId } = Route.useParams();
  const { data, isLoading, error } = useQuery(loanDetailQueryOptions(publicId));
  const [extendOpen, setExtendOpen] = useState(false);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const { hasPermission } = useAuth();

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (error || !data) {
    return (
      <PageContainer width="app">
        <p className="text-sm text-muted-foreground">Loan not found.</p>
        <Button asChild variant="ghost" size="sm" className="mt-2">
          <Link to="/gear/loans">
            <ArrowLeft className="size-4" />
            Back to loans
          </Link>
        </Button>
      </PageContainer>
    );
  }
  const isActive = data.returnedAt === null;
  // Only an open COUNTED loan can close short, and only on `gear:manage`
  // — the action re-checks both. `hasPermission`, not the payload, so
  // role emulation narrows it like every other gate.
  const canWriteOff =
    isActive && data.gearPublicId === null && hasPermission("gear:manage");
  return (
    <PageContainer width="app" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/gear/loans">
            <ArrowLeft className="size-4" />
            Back to loans
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {isActive ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExtendOpen(true)}
            >
              <CalendarClock className="size-4" />
              Extend
            </Button>
          ) : null}
          {canWriteOff ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWriteOffOpen(true)}
            >
              <PackageX className="size-4" />
              Write off
            </Button>
          ) : null}
          {/* The desk trigger opens the same Sheet officers use everywhere
           * else — pre-filling the check-in pane would be nicer, but
           * adding the gear from here is one search away. */}
          <GearDeskTrigger canLoan />
        </div>
      </div>
      <LoanDetailCard loan={data} />
      <LoanExtendDialog
        loan={data}
        open={extendOpen}
        onOpenChange={setExtendOpen}
      />
      {canWriteOff ? (
        <LoanWriteOffDialog
          loan={data}
          open={writeOffOpen}
          onOpenChange={setWriteOffOpen}
        />
      ) : null}
      {/* A counted loan ("six draws") has no single item page to open,
          so the link only renders for a coded loan. */}
      <div className="flex justify-end">
        {data.gearPublicId !== null ? (
          <Button asChild variant="link" size="sm">
            <Link to="/gear/$publicId" params={{ publicId: data.gearPublicId }}>
              <Inbox className="size-4" />
              View gear
            </Link>
          </Button>
        ) : null}
      </div>
    </PageContainer>
  );
}
