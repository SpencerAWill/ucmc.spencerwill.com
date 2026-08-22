/**
 * Tab bar rendered by the `/members/_tabs` pathless layout. Each tab is
 * a real sibling route so browser back/forward + bookmarks work and each
 * tab keeps its own URL state. Returns `null` for users without
 * `members:manage` so the directory looks unchanged for them.
 *
 * The companion `getMembersTabSubtitle()` exports the per-tab subtitle
 * string so the layout can pair it tightly with the H1; keeping the
 * description map next to the tab list ensures adding or renaming a
 * tab is a one-edit change.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";
import {
  RETENTION_DEACTIVATED_COPY,
  RETENTION_REJECTED_COPY,
} from "#/config/legal";
import { useAuth } from "#/features/auth/api/use-auth";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

export type MembersTabId =
  | "approved"
  | "pending"
  | "unclaimed"
  | "rejected"
  | "deactivated";

export function activeMembersTabFromPath(pathname: string): MembersTabId {
  if (pathname.startsWith("/members/pending")) return "pending";
  if (pathname.startsWith("/members/unclaimed")) return "unclaimed";
  if (pathname.startsWith("/members/rejected")) return "rejected";
  if (pathname.startsWith("/members/deactivated")) return "deactivated";
  return "approved";
}

const TAB_SUBTITLES: Record<MembersTabId, string> = {
  approved: "Approved club members.",
  pending:
    "New registrations awaiting an officer’s decision. Approving grants the “member” role automatically.",
  unclaimed:
    "Real-world members an officer pre-added so off-platform records (gear, attendance) can reference a stable account before the person ever signs in. They claim the row by clicking their first magic link.",
  rejected: `Registrations an officer declined. Un-rejecting moves users back to the pending queue. ${RETENTION_REJECTED_COPY}`,
  deactivated: `Approved members an officer turned off — sessions revoked, role removed, hidden from the directory. Reactivating restores the member role. ${RETENTION_DEACTIVATED_COPY}`,
};

export function getMembersTabSubtitle(pathname: string): string {
  return TAB_SUBTITLES[activeMembersTabFromPath(pathname)];
}

export function MembersTabsBar() {
  const { hasPermission } = useAuth();
  const pathname = useLocation({ select: (l) => l.pathname });
  // Per-page kill switches: hide any tab whose page has been switched off
  // from /settings. The route also 404s independently.
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const pages = flags.pages;

  if (!hasPermission("members:manage")) {
    return null;
  }

  const active = activeMembersTabFromPath(pathname);

  return (
    // Five labels can't share one row on phones without truncation
    // ("Deactivated" alone needs ~90 px). A 3-col grid gives a clean
    // 3+2 layout on mobile; from `sm` (640 px) on, fall back to a
    // single flex row.
    <div className="grid grid-cols-3 gap-1 rounded-md border p-1 sm:flex">
      {pages.members_approved ? (
        <TabLink active={active === "approved"}>
          <Link to="/members" search={{}}>
            Approved
          </Link>
        </TabLink>
      ) : null}
      {pages.members_pending ? (
        <TabLink active={active === "pending"}>
          <Link to="/members/pending" search={{}}>
            Pending
          </Link>
        </TabLink>
      ) : null}
      {pages.members_unclaimed ? (
        <TabLink active={active === "unclaimed"}>
          <Link to="/members/unclaimed" search={{}}>
            Unclaimed
          </Link>
        </TabLink>
      ) : null}
      {pages.members_rejected ? (
        <TabLink active={active === "rejected"}>
          <Link to="/members/rejected" search={{}}>
            Rejected
          </Link>
        </TabLink>
      ) : null}
      {pages.members_deactivated ? (
        <TabLink active={active === "deactivated"}>
          <Link to="/members/deactivated" search={{}}>
            Deactivated
          </Link>
        </TabLink>
      ) : null}
    </div>
  );
}

function TabLink({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      asChild
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className="sm:flex-1"
    >
      {children}
    </Button>
  );
}
