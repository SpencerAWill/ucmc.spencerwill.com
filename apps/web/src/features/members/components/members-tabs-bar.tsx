/**
 * Tab bar rendered by the `/members/_tabs` pathless layout. Each tab is
 * a real sibling route so browser back/forward + bookmarks work and each
 * tab keeps its own URL state. Returns `null` for users without
 * `members:manage` so the directory looks unchanged for them.
 */
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button";
import { useAuth } from "#/features/auth/api/use-auth";

type TabId = "approved" | "pending" | "unclaimed" | "rejected" | "deactivated";

function activeTabFromPath(pathname: string): TabId {
  if (pathname.startsWith("/members/pending")) return "pending";
  if (pathname.startsWith("/members/unclaimed")) return "unclaimed";
  if (pathname.startsWith("/members/rejected")) return "rejected";
  if (pathname.startsWith("/members/deactivated")) return "deactivated";
  return "approved";
}

export function MembersTabsBar() {
  const { hasPermission } = useAuth();
  const pathname = useLocation({ select: (l) => l.pathname });

  if (!hasPermission("members:manage")) {
    return null;
  }

  const active = activeTabFromPath(pathname);

  return (
    // On phones five labels don't fit on one row without truncating
    // ("Deactivated" alone is ~90 px); a 2-column grid keeps every label
    // legible. From `sm` (640 px) on, fall back to a single flex row.
    <div className="grid grid-cols-2 gap-1 rounded-md border p-1 sm:flex">
      <TabLink active={active === "approved"}>
        <Link to="/members" search={{}}>
          Approved
        </Link>
      </TabLink>
      <TabLink active={active === "pending"}>
        <Link to="/members/pending" search={{}}>
          Pending
        </Link>
      </TabLink>
      <TabLink active={active === "unclaimed"}>
        <Link to="/members/unclaimed" search={{}}>
          Unclaimed
        </Link>
      </TabLink>
      <TabLink active={active === "rejected"}>
        <Link to="/members/rejected" search={{}}>
          Rejected
        </Link>
      </TabLink>
      <TabLink active={active === "deactivated"}>
        <Link to="/members/deactivated" search={{}}>
          Deactivated
        </Link>
      </TabLink>
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
