---
paths:
  - "apps/ucmc-web/src/server/db/**"
  - "apps/ucmc-web/drizzle/migrations/*fts*"
  - "apps/ucmc-web/src/features/*/server/*repo.server.ts"
  - "apps/ucmc-web/src/features/members/server/member-actions.server.ts"
---

# Free-text search

Part of the data rule; `data/core.md` covers the D1 parameter limit.

## Free-text search: trigram FTS5 for prose, `likeContains` for the rest

**Names, emails, gear notes and model names search through `searchMatches()`** (`src/server/db/search.ts`) against four trigram FTS5 tables from `0081_search_fts.sql`: `profiles_fts`, `user_emails_fts`, `gear_items_fts`, `gear_models_fts`. **Codes and type names stay on `likeContains`** — officers type partial codes off a tag, often under three characters. #189 has the measurements.

- **Trigram, not the default tokenizer**, so matching is still a case-insensitive _substring_ match — "mith" finds "Smith", as LIKE did. `unicode61` would have quietly changed that to word-prefix matching. A needle under three characters has no trigram and would match nothing, so `searchMatches` falls back to `likeContains` over the FTS table's own columns. **Case folding therefore differs by length**: three characters up folds Unicode ("ébert" finds "Ébert"), the fallback folds ASCII only, as LIKE always did. SQLite has no Unicode `lower()` without ICU, so the two can't be made to agree cheaply; the test pins both sides.
- **User input is bound _and_ quoted** as one FTS5 string (`"` doubled). Binding stops SQL injection but not FTS5's own query language: unquoted, `"`, `*`, `NEAR(`, `col:` are a syntax _error_, not a bad match.
- **Each FTS table's rowid is the `INTEGER PRIMARY KEY` of a `*_fts_keys` table** mapping it to the base row's text id(s). Not external-content: our tables have text primary keys, so that would key on the implicit rowid, which `VACUUM` or a table rebuild can renumber — after which the index returns the wrong rows, silently. Not an `UNINDEXED` key column inside the FTS table either: FTS5 can't look one up, so each update/delete trigger scanned the whole index, and a retention sweep deleting N users in one statement paid that N times. Through the key table every trigger is a point lookup; `search-fts.test.ts` pins it with D1's `rows_read`. Update triggers carry a `WHEN old IS NOT new` guard because the profile forms SET every column on every save.
- **Triggers keep them in sync, and triggers belong to their table**: a migration that rebuilds `profiles`, `user_emails`, `gear_items` or `gear_models` drops them and must recreate them (`search-fts.test.ts` fails if any is missing). FK cascades do fire them (pinned). **`INSERT OR REPLACE` does not** — REPLACE's implicit delete fires delete triggers only with `recursive_triggers` on — so never write these tables that way; `ON CONFLICT DO UPDATE` is fine.
- **The two personal-data tables run `secure-delete`**, so a deleted name or address leaves the index immediately rather than at the next segment merge — otherwise retention sweeps and account deletion would leave it reconstructible from `*_fts_data`.
- **`wrangler d1 export` refuses a database containing virtual tables.** Nothing uses export (Time Travel is the recovery path); anyone who needs it must drop the four FTS tables (and empty their `*_fts_keys` tables) first and re-run the migration's backfill after.
- **Search across joined tables must be phrased against the outer table's own indexed keys.** `listLoans` used to OR matches over its joined `gear_items` / `profiles` / `user_emails` columns; no index can serve an OR no single table owns, so SQLite walked every loan regardless — moving those columns onto FTS changed nothing until each branch became an `IN` on `gear_loans.item_id` / `model_id` / `member_user_id` (41 ms → 2 ms at 25k loans). `loanSearchWhere` is the pattern.

`likeContains(column, query)` lives in `src/server/db/index.ts`, beside `isUniqueViolation` / `isForeignKeyViolation`. It builds the `%needle%` pattern, escapes `%` / `_` / `\` in the user's input, **and emits the `ESCAPE` clause** — the last part is load-bearing and is why this is one helper rather than a bare needle-builder. SQLite only honours an escape character when the pattern carries an explicit `ESCAPE`, and Drizzle's `like()` never emits one, so escaping without it is _worse_ than not escaping: `50%` becomes `%50\%%`, which matches a literal backslash and therefore nothing.
