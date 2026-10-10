/**
 * The `/analytics` page registry: one entry per surface, naming the
 * route it serves, the page flag that switches it off, and the
 * permissions that reveal it.
 *
 * **A registry rather than six copies of the same list**, for the same
 * reason `settings-registry.ts` and `notification-registry.ts` are
 * registries: the sidebar's sub-menu, the root dashboard's door cards,
 * the drill-down sub-nav, and each route's own guard all have to agree
 * about which pages exist and who may see them. Spelled out at four
 * call sites they drift, and the drift is silent — a door card linking
 * to a page that 404s, or a sidebar entry a viewer can't open.
 *
 * Pure data, deliberately. `src/config/` holds no React and no lucide
 * (check before adding either), so the icons live beside the components
 * that render them, in a map typed `satisfies Record<AnalyticsPageKey,
 * …>` so adding a page here fails the typecheck until the icon exists.
 *
 * ## Two permissions, not one
 *
 * `analytics:view` opens the area and nothing else. Every page also
 * declares `dataPermissions` — at least one of which the viewer must
 * hold — naming the permission for the data the page actually shows.
 * That is what keeps a Trip Coordinator out of the waiver roster while
 * still letting them read the activity page, and it is why the gates
 * stay on the data rather than on the route. See
 * `0080_analytics_permission.sql`.
 *
 * A page whose `dataPermissions` the viewer fails is hidden from the
 * nav and `notFound`s on direct navigation — the same treatment a
 * switched-off page gets, and for the same reason: an officer should
 * not be able to tell a page they may not read from a page that does
 * not exist.
 */

/** Opens the `/analytics` area. Grants no data on its own. */
export const ANALYTICS_VIEW_PERMISSION = "analytics:view";

export interface AnalyticsPageMeta {
  /** Route path, as the router spells it. */
  readonly path: string;
  /** Sidebar / door-card label. */
  readonly label: string;
  /**
   * The one question the page answers, in the officer's words. Rendered
   * verbatim under the page heading, so it is copy, not a description
   * of the code.
   */
  readonly question: string;
  /**
   * The `pages.*` kill switch, WITHOUT the `pages.` prefix — i.e. the
   * key as `flags.pages[...]` exposes it. Typed loosely here because
   * `PageFlagKey` is derived from the settings registry, and importing
   * it would make `src/config/` depend on `src/server/`.
   */
  readonly flag: string;
  /**
   * The viewer needs `analytics:view` AND at least one of these. Empty
   * is not permitted: a page with no data gate is a page whose data
   * nobody decided who could read.
   */
  readonly dataPermissions: readonly string[];
}

export const ANALYTICS_PAGES = {
  membership: {
    path: "/analytics/membership",
    label: "Membership",
    question: "Is the club growing, and do people come back?",
    flag: "analytics_membership",
    dataPermissions: ["members:manage", "members:view_private"],
  },
  gear: {
    path: "/analytics/gear",
    label: "Gear",
    question: "Is the inventory working, and where is it?",
    flag: "analytics_gear",
    dataPermissions: ["gear:read", "gear:manage", "gear:loan"],
  },
  activity: {
    path: "/analytics/activity",
    label: "Activity",
    question: "What did the club actually do?",
    flag: "analytics_activity",
    dataPermissions: ["events:manage", "events:read_private"],
  },
  compliance: {
    path: "/analytics/compliance",
    label: "Compliance",
    question: "Are we meeting our obligations?",
    flag: "analytics_compliance",
    dataPermissions: ["waivers:view", "waivers:verify"],
  },
  platform: {
    path: "/analytics/platform",
    label: "Platform",
    question: "Is the site healthy and inside its limits?",
    // Operational spend and free-tier headroom. `settings:manage` is
    // the closest existing "runs the site" permission; system_admin
    // reaches it through the principal bypass either way.
    flag: "analytics_platform",
    dataPermissions: ["settings:manage"],
  },
} as const satisfies Record<string, AnalyticsPageMeta>;

export type AnalyticsPageKey = keyof typeof ANALYTICS_PAGES;

/**
 * Display order — the order the doors appear on the root dashboard and
 * in the sidebar sub-menu.
 *
 * Deliberately not `Object.keys()`: key order in an object literal is
 * an implementation detail that a reformat or a merge can reorder,
 * whereas this list is a decision. Membership first because it is the
 * question officers ask most; Platform last because it is the only one
 * that is not about the club.
 */
export const ANALYTICS_PAGE_ORDER = [
  "membership",
  "gear",
  "activity",
  "compliance",
  "platform",
] as const satisfies readonly AnalyticsPageKey[];

/**
 * Whether a viewer may see a given analytics page's data.
 *
 * Takes a **predicate** rather than a permission list, because the two
 * callers hold the answer in different shapes and neither should be
 * made to produce the other: components pass `hasPermission` from
 * `useAuth`, route guards pass a closure over
 * `effectivePermissionsFor(...)`. Both already respect role emulation;
 * `principal.permissions.includes()` does not, and must never be the
 * thing passed in here (see `.claude/rules/auth-and-rbac.md`).
 */
export function canSeeAnalyticsPage(
  has: (permission: string) => boolean,
  key: AnalyticsPageKey,
): boolean {
  return (
    has(ANALYTICS_VIEW_PERMISSION) &&
    ANALYTICS_PAGES[key].dataPermissions.some((p) => has(p))
  );
}

/**
 * Every analytics page the viewer may open, in display order, after
 * both the permission check and the page flags.
 *
 * `flags` is the EFFECTIVE page-flag map (`flags.pages`), which has
 * already folded in the `pages.analytics` parent — so no caller has to
 * remember to AND the section switch itself.
 */
export function visibleAnalyticsPages(
  has: (permission: string) => boolean,
  flags: Readonly<Record<string, boolean>>,
): AnalyticsPageKey[] {
  return ANALYTICS_PAGE_ORDER.filter(
    (key) => canSeeAnalyticsPage(has, key) && flags[ANALYTICS_PAGES[key].flag],
  );
}
