import { Link } from "@tanstack/react-router";
import { format, formatDistanceToNowStrict } from "date-fns";

import { Badge } from "#/components/ui/badge";
import { Card } from "#/components/ui/card";
import { gearThumbnailUrlFor } from "#/features/gear/lib/thumbnail-url";
import type { LoanSummary } from "#/features/gear/server/gear-fns";

const PLACEHOLDER = "/gear-placeholder.svg";

/**
 * List-card view of a single loan on `/gear/loans`. Mirrors the
 * gear-card layout (`Card` + CSS grid + image-fills-its-column) so the
 * two list surfaces feel consistent. Grid (not the `Item` primitive)
 * because grid naturally stretches every cell to row height — the
 * only reliable way to make the image take the full vertical space
 * regardless of how many badges land in the content column.
 *
 * The whole row is a `<Link>` to the loan detail page; nested links
 * (image → gear page) would break the outer's click target, so the
 * image stays inside the same anchor.
 */
export function LoanCard({ loan }: { loan: LoanSummary }) {
  const overdue = loan.returnedAt === null && loan.dueAt.getTime() < Date.now();
  return (
    <li>
      <Link
        to="/gear/loans/$publicId"
        params={{ publicId: loan.publicId }}
        className="block"
      >
        <Card className="overflow-hidden p-0 transition-shadow hover:shadow-md">
          <div className="grid grid-cols-[5rem_1fr] sm:grid-cols-[7rem_1fr]">
            <div className="bg-muted">
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
            <div className="min-w-0 space-y-1 p-3 sm:p-4">
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
                    Due{" "}
                    {formatDistanceToNowStrict(loan.dueAt, { addSuffix: true })}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </Card>
      </Link>
    </li>
  );
}
