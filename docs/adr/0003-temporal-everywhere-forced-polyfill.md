# 0003. Temporal for every timestamp, with the polyfill forced

- **Status:** Accepted
- **Date:** 2026-06-08 (polyfill forced 2026-10-19)
- **Issue:** #118, #313

## Context

The club lives on a local calendar: trips, gear due dates, the season (ADR 0004), recurring meetings. `Date` knows two zones, the host's and UTC. The Worker runs in UTC and the browser in the viewer's zone, so a calendar field read straight off an instant is wrong for one of them and a hydration mismatch between them. `date-fns` arithmetic on `Date` drifts an hour across daylight saving, and a weekly 18:00 meeting has to stay at 18:00.

Workers has no stable native `Temporal`. In July 2026 workerd briefly shipped one whose clock read epoch 0 inside requests ([cloudflare/workerd#6907](https://github.com/cloudflare/workerd/issues/6907)). Both `temporal-polyfill/global` and the package root defer to a native `Temporal` when one exists, so code using either would have picked up the broken one, and every test would have passed, because the tests run under the same workerd.

## Decision

- **`Temporal` (via `temporal-polyfill`) is the timestamp type everywhere.** `date-fns` is gone. `Date` survives only at hard external boundaries (R2 metadata, `<input type="date">`, `react-day-picker`).
- **The polyfill is installed onto the global unconditionally** by `#/lib/temporal-install`, which every entry point imports first. ESLint bans the deferring imports in `src/`. Moving to native Temporal is a deliberate edit to that one file once it has proven stable on Workers. The runtime never decides it.
- **D1 stores integer milliseconds** behind a `customType` that reads and writes `Temporal.Instant`. Serialization adapters on `createStart` carry Temporal values across the SSR and server-function wire.
- **Calendar reasoning runs in `CLUB_TIME_ZONE` (`America/New_York`)**, never UTC and never the runtime default. Exact elapsed time (`instant.add`) is for timeouts and retention. Calendar arithmetic in the club zone is for anything a person reads off a calendar.

## Consequences

- One type at every layer, and DST-correct calendar maths by construction.
- The polyfill's weight is in every bundle, client included, until native Temporal is adopted.
- Every entry point (server, router, Storybook, vitest setups, e2e fixtures) must import the installer first. A new entry point that forgets it fails at the first `Temporal` reference.
- Display is a separate choice: `#/lib/date-format` renders in the viewer's zone, and the calendar deliberately renders in the club's (ADR 0008).
