import { Link } from "@tanstack/react-router";
import { format, formatDistanceToNowStrict } from "date-fns";

import { Badge } from "#/components/ui/badge";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import type { LoanSummary } from "#/features/gear/server/gear-fns";

const PLACEHOLDER = "/gear-placeholder.svg";

/**
 * Compact row for `/gear/loans`. The whole row is a `<Link>` to the
 * loan detail page; the gear-code badge separately deep-links to the
 * piece so officers can jump straight to the gear if they're trying
 * to inspect a return.
 */
export function LoanCard({ loan }: { loan: LoanSummary }) {
  const overdue = loan.returnedAt === null && loan.dueAt.getTime() < Date.now();
  return (
    <li>
      <Link
        to="/gear/loans/$publicId"
        params={{ publicId: loan.publicId }}
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
          <p className="text-xs text-muted-foreground">
            {loan.typeName} · {loan.memberFullName}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {loan.returnedAt ? (
              <Badge variant="outline">
                Returned {format(loan.returnedAt, "MMM d")}
              </Badge>
            ) : overdue ? (
              <Badge variant="destructive">
                Overdue · due{" "}
                {formatDistanceToNowStrict(loan.dueAt, { addSuffix: true })}
              </Badge>
            ) : (
              <Badge variant="secondary">
                Due {formatDistanceToNowStrict(loan.dueAt, { addSuffix: true })}
              </Badge>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
