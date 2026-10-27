# 0006. No D1 statement binds a number of parameters that grows with the data

- **Status:** Accepted
- **Date:** 2026-10-11
- **Issue:** #291 (after #259, #261)

## Context

D1 refuses a statement that binds more than 100 parameters ([limits](https://developers.cloudflare.com/d1/platform/limits/)). That is D1's limit, not Drizzle's: Drizzle emits a correct statement and the driver refuses to bind it. Two ordinary shapes grow with the data. `inArray(col, list)` binds one parameter per element. `insert().values(rows)` binds one per column per row, so 15 audit rows (7 columns each) already fail.

It broke twice. #259 was a 500 once a table crossed ~100 rows in a window. The fix, #261's `selectInChunks`, split one query into several, and Workers Free allows only 50 D1 queries per invocation, so chunking trades one limit for another and loses a single `ORDER BY`. #291 then audited every query and found 37 unbounded statements and 20 caps that still let a statement past 100.

## Decision

The rule is about a statement's **shape**, not about the call sites that happen to have broken. A statement's parameter count never depends on the data. Use these tools, in order of preference:

1. **A subquery or join when the list came out of the database** (`inSubquery` / `notInSubquery`, typed to reject an array).
2. **`inJsonArray` / `notInJsonArray` when the list came from the caller**: one JSON parameter expanded by `json_each`, D1's own documented pattern. This includes fixed constant lists, so there is one sanctioned form.
3. **`insertStatements` / `insertMany` for multi-row writes**: rows split to fit, run as one atomic batch.
4. **Cross products built in SQL** (`INSERT … SELECT … FROM json_each(?) CROSS JOIN json_each(?)`), never in JavaScript.

ESLint bans Drizzle's `inArray` / `notInArray` everywhere except the test that pins the ceiling against real D1.

## Consequences

- Bulk actions work at any size, in one round trip.
- Caps on callers are no longer a fix. The caps that remain are product bounds, and no statement's size depends on them.
- Inserts aren't lint-guarded, because a fixed small `.values(rows)` is legitimate. A new bulk write goes through `insertStatements` by convention, with a test past the old limit.
- Whether each statement inside a `batch()` counts toward the 50 queries per invocation is undocumented and unverified, so batches stay short.
