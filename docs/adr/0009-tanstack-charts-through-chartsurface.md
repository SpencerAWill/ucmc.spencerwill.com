# 0009. TanStack Charts, mounted through `ChartSurface`

- **Status:** Accepted
- **Date:** 2026-10-10
- **Issue:** #267, #276

## Context

The officer analytics area (`/analytics`) needed charts. `recharts` was already installed through shadcn's `chart.tsx`, but it renders on the client: the server sends an empty box and the chart pops in after hydration. `@tanstack/charts` renders the complete SVG on the server when it knows its size. #267 §5 adopted it on trial.

The audience is a handful of officers looking at a club of a few hundred members, so small differences are easy to over-read. The site's six categorical colour slots are tuned to the theme, and three of them sit under 3:1 contrast against the card.

## Decision

- **`@tanstack/charts` for every new chart**, read from its version-locked docs in `node_modules/@tanstack/charts/docs/` and the skills symlinked into `.claude/skills/`.
- **Every chart mounts through `ChartSurface`**, never `<Chart>` directly. It owns four things each chart would otherwise get wrong on its own:
  - the `--chart-*` → `--ts-chart-*` palette bridge,
  - a required `ariaLabel`,
  - SSR sizing (`height` / `initialWidth`), so the full SVG is in the HTML response,
  - the exact-value table, which three low-contrast slots make an obligation rather than a nicety.
- **Charts name no colours.** `--chart-*` is **identity** (which series) and `--chart-ramp-*` is **magnitude** (how much). Each is used only for its own job.

## Consequences

- No layout jump at hydration, and every chart is accessible and readable without colour.
- A new chart can't skip the table, the label or the sizing.
- The trial is still live. `recharts` stays installed only for the vendored `src/components/ui/chart.tsx`, and removing it is a follow-up.
- Chart honesty rules sit beside this in the analytics rule (counts before percentages, a `null` for a zero denominator, no-data distinct from zero), because N is small enough that a percentage can be three people.
