/**
 * The "go deeper" cards on the root dashboard — one per drill-down the
 * viewer may open.
 *
 * Each card carries its page's own question rather than a generic
 * blurb, because the question is the thing that tells an officer which
 * door to open. Same source as the sub-nav and the sidebar
 * (`#/config/analytics-pages`).
 */
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Card } from "#/components/ui/card";
import {
  ANALYTICS_PAGES,
  visibleAnalyticsPages,
} from "#/config/analytics-pages";
import { ANALYTICS_PAGE_ICONS } from "#/components/analytics-page-icons";
import { useAuth } from "#/features/auth/api/use-auth";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

export function AnalyticsDoors() {
  const { hasPermission } = useAuth();
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const visible = visibleAnalyticsPages(hasPermission, flags.pages);

  if (visible.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Go deeper</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((key) => {
          const page = ANALYTICS_PAGES[key];
          const Icon = ANALYTICS_PAGE_ICONS[key];
          return (
            <li key={key}>
              <Card className="h-full p-0 transition-colors hover:border-primary/50">
                {/*
                  The whole card is the link rather than a trailing
                  "View →": the card has one destination, so anything
                  smaller than the card is a smaller tap target for no
                  gain. `h-full` on both keeps a short question from
                  leaving a ragged grid row.
                */}
                <Link
                  to={page.path}
                  className="flex h-full flex-col gap-1 rounded-xl p-4 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Icon className="size-4 text-muted-foreground" />
                    {page.label}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {page.question}
                  </span>
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
