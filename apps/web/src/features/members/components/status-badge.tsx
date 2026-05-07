import type { ComponentProps } from "react";

import { Badge } from "#/components/ui/badge";
import type { UserStatus } from "#/../drizzle/schema";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

/**
 * Status values this component can render. Excludes `"unclaimed"` —
 * officer-pre-added stubs are surfaced via the dedicated
 * `/members/registrations` "Unclaimed" tab and never appear in the
 * directory listing or the per-member detail page (both server actions
 * filter `status = 'unclaimed'` out). Excluding it from the prop type
 * propagates the contract upstream: any caller that *would* hand us an
 * unclaimed status fails typecheck, surfacing a missing filter.
 */
export type StatusBadgeStatus = Exclude<UserStatus, "unclaimed">;

const STATUS_VARIANTS: Record<StatusBadgeStatus, BadgeVariant> = {
  approved: "success",
  pending: "warning",
  rejected: "destructive",
  deactivated: "secondary",
};

const STATUS_LABELS: Record<StatusBadgeStatus, string> = {
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
  deactivated: "Deactivated",
};

export function StatusBadge({ status }: { status: StatusBadgeStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} className="rounded px-1.5 py-0.5">
      {STATUS_LABELS[status]}
    </Badge>
  );
}
