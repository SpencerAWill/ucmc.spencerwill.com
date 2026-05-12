import { Link } from "@tanstack/react-router";
import { format } from "date-fns";

import { Badge } from "#/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import type {
  GearCondition,
  LoanDetail,
} from "#/features/gear/server/gear-fns";

const CONDITION_LABEL: Record<GearCondition, string> = {
  serviceable: "Serviceable",
  needs_repair: "Needs repair",
  missing: "Missing",
  lost: "Lost",
};

const PLACEHOLDER = "/gear-placeholder.svg";

export function LoanDetailCard({ loan }: { loan: LoanDetail }) {
  const overdue = loan.returnedAt === null && loan.dueAt.getTime() < Date.now();
  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Link
          to="/gear/$publicId"
          params={{ publicId: loan.gearPublicId }}
          className="aspect-square w-32 shrink-0 overflow-hidden rounded-md border bg-muted sm:w-40"
        >
          <img
            src={
              loan.thumbnailKey
                ? gearThumbnailUrlFor(loan.thumbnailKey)
                : PLACEHOLDER
            }
            alt=""
            className="h-full w-full object-cover"
          />
        </Link>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 items-center justify-center rounded border border-primary/30 bg-primary/10 px-3 font-mono text-lg font-semibold text-primary">
              {loan.code ?? "—"}
            </span>
            <div>
              <CardTitle>{loan.gearDescription}</CardTitle>
              <CardDescription>
                {loan.typeName} ·{" "}
                <Link
                  to="/gear/$publicId"
                  params={{ publicId: loan.gearPublicId }}
                  className="underline-offset-2 hover:underline"
                >
                  view gear
                </Link>
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {loan.returnedAt ? (
              <Badge variant="outline">
                Returned {format(loan.returnedAt, "MMM d, yyyy")}
              </Badge>
            ) : overdue ? (
              <Badge variant="destructive">Overdue</Badge>
            ) : (
              <Badge variant="secondary">Active</Badge>
            )}
            {loan.conditionAtReturn ? (
              <Badge variant="outline">
                Returned condition: {CONDITION_LABEL[loan.conditionAtReturn]}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Borrower</dt>
            <dd>{loan.memberFullName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Checked out</dt>
            <dd>{format(loan.checkedOutAt, "MMM d, yyyy")}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {loan.returnedAt ? "Was due" : "Due"}
            </dt>
            <dd>{format(loan.dueAt, "MMM d, yyyy")}</dd>
          </div>
          {loan.checkedOutByName ? (
            <div>
              <dt className="text-xs text-muted-foreground">Issued by</dt>
              <dd>{loan.checkedOutByName}</dd>
            </div>
          ) : null}
          {loan.returnedByName ? (
            <div>
              <dt className="text-xs text-muted-foreground">Received by</dt>
              <dd>{loan.returnedByName}</dd>
            </div>
          ) : null}
        </dl>
        {loan.checkoutNotes ? (
          <div className="rounded border bg-background p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Checkout notes
            </p>
            <p className="whitespace-pre-wrap text-sm">{loan.checkoutNotes}</p>
          </div>
        ) : null}
        {loan.checkinNotes ? (
          <div className="rounded border bg-background p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Check-in notes
            </p>
            <p className="whitespace-pre-wrap text-sm">{loan.checkinNotes}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
