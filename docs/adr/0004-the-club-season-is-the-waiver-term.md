# 0004. The club season runs Aug 1 → Jul 31, and is the waiver term

- **Status:** Accepted
- **Date:** 2026-10-09
- **Issue:** #270

## Context

Several features ask "which club year is this?": the waiver guard (is this member covered?), `/volunteer`'s service archive, member tenure and profile rings, and every analytics chart. Each had a reason to derive an August boundary itself, and parallel derivations disagree the first time the boundary moves.

It has moved. The boundary used to sit on Aug 21, a proxy for UC's first day of classes. That date changes every year, and the club runs trips in early August, before it. Reporting also needed periods inside a season. UC's academic calendar is week-shaped, moves yearly, and has gaps that belong to no term (winter break), so activity in a break would land nowhere.

## Decision

- **A season runs Aug 1 → Jul 31, rolling over at midnight Cincinnati-local, labelled `"YYYY-YY"`.** `src/config/club-season.ts` is its only definition: `currentSeason()` plus the range helpers (`seasonBoundsFor`, `seasonsBetween`, `seasonOffsetOf`, `semesterOf`, `semesterBoundsFor`). Ranges are half-open.
- **The waiver term is the season**, with no grace window. `attestWaiver` stamps `cycle = currentSeason()`, so a waiver signed mid-season covers the rest of that season, and collection is continuous from Aug 1.
- **Semesters are reporting periods that partition the season totally**: Fall Aug–Dec, Spring Jan–Apr, Summer May–Jul. They are not UC's academic terms. If real term dates are ever needed, they go in a table of hand-entered dates, not into this partition.

## Consequences

- One helper answers the waiver guard, tenure, `/volunteer` and analytics, so they cannot disagree.
- Aug 1 is earlier than any club trip and does not pretend to be the academic calendar.
- Semesters are unequal (5, 4 and 3 months), so a per-month rate must divide by `monthCount`. Raw totals make Fall look busier for free.
- Analytics plots on a season axis (month 0 = August), so seasons overlay and a partial season compares against the same point in earlier ones.
- Some boundaries are deliberately not the season's. The profile ring closes on May 1 (`SEASON_END_CUTOFF`), when spring ends, not at the August rollover.
