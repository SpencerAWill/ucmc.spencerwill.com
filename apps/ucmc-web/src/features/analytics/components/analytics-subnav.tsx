/**
 * The row of links between the six analytics surfaces, rendered under
 * the heading on every page in the area.
 *
 * Reads `#/config/analytics-pages` rather than listing the pages, so
 * the nav, the door cards, the sidebar sub-menu and each route guard
 * all answer "which pages exist, and may this viewer open them?" from
 * one place.
 *
 * Entries the viewer cannot open are **absent**, not disabled: a
 * disabled control tells an officer there is a page they are missing
 * out on, which is information this nav has no business leaking.
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import {
  ANALYTICS_PAGES,
  visibleAnalyticsPages,
} from "#/config/analytics-pages";
import { ANALYTICS_PAGE_ICONS } from "#/components/analytics-page-icons";
import { useAuth } from "#/features/auth/api/use-auth";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";
import { cn } from "#/lib/utils";

export function AnalyticsSubnav() {
  const { hasPermission } = useAuth();
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const visible = visibleAnalyticsPages(hasPermission, flags.pages);

  // One door or none is not a navigation bar — it is a label for the
  // page you are already on. Render nothing rather than a lone tab.
  if (visible.length < 2) {
    return null;
  }

  return (
    <nav aria-label="Analytics sections">
      {/*
        Scrolls horizontally at phone width rather than wrapping to two
        rows: these are peers in a fixed order, and a wrapped row makes
        the last one look like a different kind of thing. `overflow-y`
        is pinned to `hidden` alongside it — per CSS Overflow 3 a
        non-`visible` value on one axis computes the other from
        `visible` to `auto`, so without it the strip captures vertical
        scroll and a touch-drag slides the page inside its own box.
      */}
      <ul className="flex gap-1 overflow-x-auto overflow-y-hidden pb-1">
        <li>
          <AnalyticsSubnavLink to="/analytics" label="Overview" />
        </li>
        {visible.map((key) => (
          <li key={key}>
            <AnalyticsSubnavLink
              to={ANALYTICS_PAGES[key].path}
              label={ANALYTICS_PAGES[key].label}
              Icon={ANALYTICS_PAGE_ICONS[key]}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function AnalyticsSubnavLink({
  to,
  label,
  Icon,
}: {
  to: string;
  label: string;
  Icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      to={to}
      // `activeOptions.exact` keeps "Overview" from lighting up on every
      // child route — `/analytics` is a prefix of all five.
      activeOptions={{ exact: to === "/analytics" }}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
        "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      activeProps={{ className: "bg-muted text-foreground" }}
    >
      {Icon ? <Icon className="size-4" /> : null}
      {label}
    </Link>
  );
}
