import type { UserStatus } from "#/../drizzle/schema";

const STATUS_STYLES: Record<UserStatus, string> = {
  approved:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  deactivated:
    "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400",
};

const STATUS_LABELS: Record<UserStatus, string> = {
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
  deactivated: "Deactivated",
};

export function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
