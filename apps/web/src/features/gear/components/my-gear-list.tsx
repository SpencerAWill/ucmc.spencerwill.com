import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, formatDistanceToNowStrict } from "date-fns";

import { Badge } from "#/components/ui/badge";
import { myLoansQueryOptions } from "#/features/gear/api/queries";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import type { LoanSummary } from "#/features/gear/server/gear-fns";

const PLACEHOLDER = "/gear-placeholder.svg";

/**
 * Member's own gear at `/my/gear`. Active loans get a card list at
 * the top; history is collapsed below since it's reference info
 * rather than something the member acts on.
 */
export function MyGearList() {
  const { data, isLoading } = useQuery(myLoansQueryOptions());
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading your gear…</p>;
  }
  const active = data?.active ?? [];
  const history = data?.history ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
          Currently out
        </h2>
        {active.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            You don't have any gear checked out right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((loan) => (
              <MyLoanRow key={loan.publicId} loan={loan} />
            ))}
          </ul>
        )}
      </section>
      {history.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
            History
          </h2>
          <ul className="space-y-2">
            {history.map((loan) => (
              <MyLoanRow key={loan.publicId} loan={loan} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function MyLoanRow({ loan }: { loan: LoanSummary }) {
  const overdue = loan.returnedAt === null && loan.dueAt.getTime() < Date.now();
  return (
    <li>
      <Link
        to="/gear/$publicId"
        params={{ publicId: loan.gearPublicId }}
        className="flex items-stretch gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-accent/40"
      >
        <div className="aspect-square w-16 shrink-0 overflow-hidden rounded border bg-muted">
          <img
            src={
              loan.thumbnailKey
                ? gearThumbnailUrlFor(loan.thumbnailKey)
                : PLACEHOLDER
            }
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="rounded border border-primary/30 bg-primary/10 px-1.5 font-mono text-xs font-semibold text-primary">
              {loan.code ?? "—"}
            </span>
            <span className="truncate text-sm font-medium">
              {loan.gearDescription}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{loan.typeName}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {loan.returnedAt ? (
              <Badge variant="outline">
                Returned {format(loan.returnedAt, "MMM d, yyyy")}
              </Badge>
            ) : overdue ? (
              <Badge variant="destructive">
                Overdue · was due{" "}
                {formatDistanceToNowStrict(loan.dueAt, { addSuffix: true })}
              </Badge>
            ) : (
              <Badge variant="secondary">
                Due {format(loan.dueAt, "MMM d, yyyy")} (
                {formatDistanceToNowStrict(loan.dueAt, { addSuffix: true })})
              </Badge>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
