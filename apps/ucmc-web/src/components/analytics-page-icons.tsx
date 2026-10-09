/**
 * Icons for the analytics pages.
 *
 * Separate from `#/config/analytics-pages` because `src/config/` holds
 * no React and no lucide imports — check before adding either. The
 * `satisfies Record<AnalyticsPageKey, LucideIcon>` is what keeps the
 * split honest: adding a page to the registry fails the typecheck here
 * until it has an icon, so the two halves cannot drift apart silently.
 *
 * Lives in `src/components/` rather than under `features/analytics/`
 * because the **sidebar** needs it, and shared chrome cannot import a
 * feature (`import/no-restricted-paths`). Same move the curated icon
 * registry made, and the alternative — a third `FEATURE_PUBLIC_API`
 * entry — is explicitly the thing the web-architecture rule says to
 * hoist instead.
 */
import { CalendarDays, Package, ScrollText, Server, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { AnalyticsPageKey } from "#/config/analytics-pages";

export const ANALYTICS_PAGE_ICONS = {
  membership: Users,
  gear: Package,
  activity: CalendarDays,
  compliance: ScrollText,
  platform: Server,
} as const satisfies Record<AnalyticsPageKey, LucideIcon>;
