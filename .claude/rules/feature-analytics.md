---
paths:
  - "apps/ucmc-web/src/features/analytics/**"
  - "apps/ucmc-web/src/config/analytics-pages.ts"
  - "apps/ucmc-web/src/components/analytics-page-icons.tsx"
  - "apps/ucmc-web/src/routes/analytics.*"
---

# Analytics (`/analytics`)

Officer-facing club-health reporting: a root dashboard plus five
drill-downs. Issue #267 settled the design; the information
architecture came from the artifact linked on #275.

## The page registry is the single source

`src/config/analytics-pages.ts` names every surface, its route, its
`pages.*` kill switch, and the permissions that reveal it. **Four
consumers read it** — the sidebar sub-menu, the root page's door
cards, the drill-down sub-nav, and each route's own `beforeLoad`. Add
a page there and all four follow; spell it out at each site and they
drift into a door card that 404s.

It is **pure data** because `src/config/` holds no React and no lucide
(check before adding either). Icons live in
`src/components/analytics-page-icons.tsx` — in `src/components/`
rather than under the feature because the **sidebar** needs them and
shared chrome cannot import a feature. The map is typed `satisfies
Record<AnalyticsPageKey, LucideIcon>`, which is what stops the two
halves drifting: a new page fails the typecheck until it has an icon.

`flag` is a bare string there, because importing `PageFlagKey` would
make `src/config/` depend on `src/server/`. A typo is therefore not a
type error — `analytics-pages.test.ts` asserts every declared flag
exists in the settings registry instead. Keep that test.

## Two permissions, and the gates sit on the data

`analytics:view` (migration 0080) opens the area and grants nothing
else. Every drill-down additionally requires one of its
`dataPermissions`. A Trip Coordinator reading the activity page must
not thereby get the waiver roster, so the gate belongs on the data,
not on the route.

- Route guards: `requirePageFlag` then `requireAnyPermissionOrNotFound`.
  **`notFound`, not redirect** — a hidden page must be
  indistinguishable from one that does not exist, the same treatment a
  switched-off page gets.
- Server actions re-check the **real** principal (`loadCurrentPrincipal`),
  never the emulated one.
- Client gates read `hasPermission` via `canSeeAnalyticsPage`, never
  `principal.permissions`.
- The root page runs each query `enabled` on the viewer's permissions,
  because the actions refuse callers who lack them. That is the gate
  working, not something to route around.

`pages.analytics` is a section switch **and** a real page; the five
children declare it as `parent`, so the cascade in
`effectivePageFlags` already ANDs it in — never AND it again by hand.

## Everything is on the season axis

Never re-derive a club year; import from `#/config/club-season`. See
the `dates-and-formats` rule for the helper table.

- **x is month-position within the season, 0 = August** — not a
  calendar month. A Jan–Dec axis cuts every season in half, and sorting
  by calendar month puts January before August.
- **State the band/point domain, never let it infer.** An inferred
  domain drops a month the club did nothing in and closes the gap,
  which is exactly the thing worth seeing.
- **Bucket through `CLUB_TIME_ZONE`.** The worker runs UTC; an 8pm
  Cincinnati event reads as tomorrow, which at a month boundary is the
  wrong bar and on Jul 31 the wrong season.
- **Divide semester totals by `SEMESTERS[s].monthCount`.** Fall is 5
  months, Spring 4, Summer 3 — raw totals flatter Fall for free.

## Honesty rules, because N is a few hundred

These are not style preferences; they are why several panels look more
verbose than they need to.

- **Counts lead, percentages follow.** "Coverage fell 8%" can be three
  people. `CoverageBar` takes the raw pair rather than a pre-computed
  share so the honest version is not optional.
- **A zero denominator returns `null`, never 0.** `lib/rates.ts` is
  where that lives. 0% claims an achievement the club did not earn.
- **"No data" and "zero" are different claims.** `AnalyticsPanelEmpty`
  is for the first; render the real figure for the second. The
  platform page's `noSnapshots` flag exists only to keep them apart.
- **Say what a page cannot answer.** `/analytics/activity` counts what
  was _scheduled_; nothing records attendance until trips (#275) ship.
  The page carries a panel saying so rather than letting a trip count
  stand in for participation.

## Charts

`@tanstack/charts`, adopted on trial per §5 of #267. **Its own docs
ship inside the package** and are version-locked — read
`node_modules/@tanstack/charts/docs/` (start at `llms.txt`) rather
than the docs site, which tracks unreleased `main`. Nine of its twelve
shipped skills are symlinked into `.claude/skills/`; see
`.claude/skills/README.md` for why symlinks rather than copies.

- **Mount every chart through `ChartSurface`.** It carries the
  `--chart-*` → `--ts-chart-*` palette bridge, a required `ariaLabel`,
  deterministic SSR sizing, and the exact-value table. Do not render
  `<Chart>` directly.
- **Do not drop `height` / `initialWidth`.** Full server-side SVG is
  the reason this library was chosen over Recharts; without a size the
  server falls back to 320 and the first paint jumps.
- **Charts name no colours.** Series identity goes on the `color` or
  `z` channel and the palette comes from the bridge.
- **Every chart owes a table.** Three of our six categorical slots sit
  under 3:1 against the card (see `styles.css`), so the exact-value
  disclosure is an obligation here, not a nicety.
- **Memoize any definition that captures data** (`useMemo` on the
  rows), and **sort rows before a line mark** — input order is path
  order, so unsorted data draws a scribble.
- `recharts` is still installed, reached only by the vendored shadcn
  `src/components/ui/chart.tsx`. Removing it is a follow-up, not a
  drive-by.

## Shape of the feature

Standard layout (see `web-architecture`), with two notes:

- **`api/` holds no `use-*.ts` mutation hooks and owes none** — the
  whole feature is read-only.
- **`server/analytics-fns.ts` re-exports only the types a COMPONENT
  names in its props.** A route infers the whole result through its
  query options, so re-exporting result types leaves exports with no
  importer and knip correctly flags them.

Pure policy — thresholds, rates, the attention derivation — lives in
`lib/` so Stryker can mutate it. An identical helper inlined into an
action is not mutation-testable and cannot be imported by a route.

## Not built yet

- **`member_activity_days`** (§1 of #267) — the append-only rollup
  behind "members active per month". It needs the privacy notice
  amended in the same change and a sweep in `retention.server.ts`; the
  officer decision is recorded on the issue. Until it lands, the root
  page's headline is the attention list rather than an activity trend.
- **Cloudflare traffic** (tier 3) — needs an account-scoped API token
  secret. Keep it in its own clearly-labelled section when it lands:
  mixing anonymous visitor counts with member counts invites exactly
  the comparison that is not valid.
- **Participation** — waits on trips (#275).
