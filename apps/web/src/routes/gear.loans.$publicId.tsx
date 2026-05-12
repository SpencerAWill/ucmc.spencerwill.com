import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, Inbox } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import { requirePermission } from "#/features/auth/guards";
import { loanDetailQueryOptions } from "#/features/gear/api/queries";
import { GearDeskTrigger } from "#/features/gear/components/gear-desk-trigger";
import { LoanDetailCard } from "#/features/gear/components/loan-detail-card";
import { LoanExtendDialog } from "#/features/gear/components/loan-extend-dialog";

export const Route = createFileRoute("/gear/loans/$publicId")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "gear:loan");
  },
  component: LoanDetailPage,
});

function LoanDetailPage() {
  const { publicId } = Route.useParams();
  const { data, isLoading, error } = useQuery(loanDetailQueryOptions(publicId));
  const [extendOpen, setExtendOpen] = useState(false);

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4">
        <p className="text-sm text-muted-foreground">Loan not found.</p>
        <Button asChild variant="ghost" size="sm" className="mt-2">
          <Link to="/gear/loans">
            <ArrowLeft className="size-4" />
            Back to loans
          </Link>
        </Button>
      </div>
    );
  }
  const isActive = data.returnedAt === null;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/gear/loans">
            <ArrowLeft className="size-4" />
            Back to loans
          </Link>
        </Button>
        <div className="flex items-center gap-2">
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
      <div className="flex justify-end">
        <Button asChild variant="link" size="sm">
          <Link to="/gear/$publicId" params={{ publicId: data.gearPublicId }}>
            <Inbox className="size-4" />
            View gear
          </Link>
        </Button>
      </div>
    </div>
  );
}
