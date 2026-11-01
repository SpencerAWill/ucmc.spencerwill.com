import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";

import { cn } from "#/lib/utils";
import { conductReportsQueryOptions } from "#/features/conduct/api/queries";

/** The marker above every conduct page title: nothing here leaves exec. */
export function ConfidentialEyebrow() {
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      <LockKeyhole aria-hidden="true" className="size-3.5" />
      Confidential · conduct officers only
    </p>
  );
}

const TABS = [
  { to: "/conduct/reports", label: "Reports" },
  { to: "/conduct/records", label: "Records" },
] as const;

/**
 * The Reports and Records tabs: real links, the selected one computed
 * from the pathname and settled through `cn()` (see `app-chrome.md`).
 * Reports carries the count of untriaged reports.
 */
export function ConductTabsBar() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const newReports = useQuery(conductReportsQueryOptions("new"));
  const newCount = newReports.data?.length ?? 0;

  return (
    <nav aria-label="Conduct sections" className="flex gap-1 border-b">
      {TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-2 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors",
              "hover:bg-muted/50 hover:text-foreground",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              isActive &&
                "border-primary bg-muted/70 font-semibold text-foreground hover:bg-muted/70",
            )}
          >
            {tab.label}
            {tab.to === "/conduct/reports" && newCount > 0 ? (
              <span className="rounded-full bg-notice-warning px-1.5 py-px text-xs font-semibold text-notice-warning-foreground">
                {newCount} new
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
