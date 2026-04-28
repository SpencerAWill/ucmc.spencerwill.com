import type { ComponentProps } from "react";

import { Badge } from "#/components/ui/badge";
import type { UserStatus } from "#/../drizzle/schema";

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

const STATUS_VARIANTS: Record<UserStatus, BadgeVariant> = {
  approved: "success",
  pending: "warning",
  rejected: "destructive",
  deactivated: "secondary",
};

const STATUS_LABELS: Record<UserStatus, string> = {
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
  deactivated: "Deactivated",
};

export function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} className="rounded px-1.5 py-0.5">
      {STATUS_LABELS[status]}
    </Badge>
  );
}
