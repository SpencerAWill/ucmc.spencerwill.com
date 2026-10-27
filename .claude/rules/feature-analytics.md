---
paths:
  - "apps/ucmc-web/src/features/analytics/**"
  - "apps/ucmc-web/src/config/analytics-pages.ts"
  - "apps/ucmc-web/src/components/analytics-page-icons.tsx"
  - "apps/ucmc-web/src/routes/analytics.*"
---

# Analytics (`/analytics`)

Officer-facing club-health reporting: a root dashboard plus five drill-downs (design: #267; information architecture: the artifact on #275). Why TanStack Charts and `ChartSurface`: `docs/adr/0009-tanstack-charts-through-chartsurface.md`. Why the season axis: `docs/adr/0004-the-club-season-is-the-waiver-term.md`. This file is the rules for changing it.

## Where things go

- **`src/config/analytics-pages.ts`** is the page registry: every surface, its route, its `pages.*` kill switch, its permissions. **Four consumers read it**: the sidebar sub-menu, the root page's door cards, the drill-down sub-nav, and each route's `beforeLoad`. Pure data: `src/config/` holds no React and no lucide.
- **`src/components/analytics-page-icons.tsx`** holds the icons, outside the feature because the sidebar needs them. Typed `satisfies Record<AnalyticsPageKey, LucideIcon>`.
- **`lib/`** holds pure policy (thresholds, rates in `lib/rates.ts`, the attention derivation), where routes can import it and Stryker could mutate it. None of `lib/` is on `stryker.config.json`'s `mutate` list yet.
- **`api/`** holds no `use-*.ts` mutation hooks and owes none; the feature is read-only.
- **`server/analytics-fns.ts`** re-exports only the types a **component** names in its props (routes infer results through query options; extra re-exports are knip findings).
- **Charts**: `@tanstack/charts`. Read its version-locked docs in `node_modules/@tanstack/charts/docs/` (start at `llms.txt`), not the docs site, which tracks unreleased `main`. Nine of its skills are symlinked into `.claude/skills/` (see `.claude/skills/README.md`).

## Rules that are easy to break

**Registry and gates**

- **Add a page in `analytics-pages.ts`, never at each consumer.** Spelled-out copies drift into a door card that 404s.
- **`flag` there is a bare string** (importing `PageFlagKey` would make `src/config/` depend on `src/server/`). Keep `analytics-pages.test.ts`, which asserts every flag exists in the settings registry.
- **`analytics:view` (migration 0080) opens the area and grants nothing else.** Each drill-down also requires one of its `dataPermissions`; the gate is on the data, not the route.
- **Route guards are `requirePageFlag` then `requireAnyPermissionOrNotFound`**: `notFound`, never a redirect.
- **Server actions re-check the real principal** (`loadCurrentPrincipal`), never the emulated one.
- **Client gates read `hasPermission` via `canSeeAnalyticsPage`**, never `principal.permissions`.
- **The root page runs each query `enabled` on the viewer's permissions.** The actions refuse callers without them; don't route around it.
- **`pages.analytics` is the five children's `parent`**; `effectivePageFlags` already ANDs it in. Never AND it again by hand.

**Season axis**

- **Never re-derive a club year**; import from `#/config/club-season`.
- **x is month-position within the season, 0 = August**, not a calendar month.
- **State the band/point domain explicitly**; an inferred one drops empty months and hides the gap.
- **Bucket through `CLUB_TIME_ZONE`.**
- **Divide semester totals by `SEMESTERS[s].monthCount`.**

**Honesty (N is a few hundred)**

- **Counts lead, percentages follow.** `CoverageBar` takes the raw pair, not a share.
- **A zero denominator returns `null`, never 0** (`lib/rates.ts`).
- **"No data" and "zero" are different.** `AnalyticsPanelEmpty` is for no data; the platform page's `noSnapshots` flag keeps them apart.
- **Say what a page can't answer.** `/analytics/activity` counts what was scheduled, and says so, until trips (#275) record attendance.

**Charts**

- **Mount every chart through `ChartSurface`**, never `<Chart>` directly.
- **Keep `height` / `initialWidth`.** Without them the server falls back to 320 and the first paint jumps.
- **Charts name no colours.** Series identity goes on `color` or `z`; `--chart-*` is identity and `--chart-ramp-*` magnitude (`styles.css`).
- **Every chart keeps its exact-value table.** Three of the six categorical slots are under 3:1 against the card.
- **Memoize any definition that captures data** (`useMemo` on the rows), and **sort rows before a line mark** (input order is path order).
- **Don't remove `recharts` in passing.** Only the vendored `src/components/ui/chart.tsx` reaches it; removing it is its own follow-up.

**Platform page (`cost_snapshots`)**

- **Keep the two windows separate** (`analyticsWindow` vs `planSnapshotWindow`). Billable Usage (R2) keeps ~108 days and backfills 90-day spans; the GraphQL datasets (Workers, D1, KV) reject any range wider than `4w4d` (31 days answers, 32 errors) and only ever go trailing. Handing them the backfill window deadlocked the job.
- **Keep the backfill-floor test looking at billing rows alone**; analytics returns rows on every run.

## Adding things

- **A drill-down**: an entry in `analytics-pages.ts`, an icon in the `satisfies` map (the typecheck fails until it has one), its `pages.*` flag with `parent: "analytics"`, and its `dataPermissions`.
- **A pure helper**: in `lib/`, not inlined into an action.

## Not built yet

- **`member_activity_days`** (#267 §1), the rollup behind "members active per month". It needs the privacy notice amended in the same change and a sweep in `retention.server.ts`; the officer decision is on the issue.
- **Cloudflare traffic** needs an account-scoped API token secret, and goes in its own labelled section: anonymous visitor counts must not sit beside member counts.
- **Participation** waits on trips (#275).
