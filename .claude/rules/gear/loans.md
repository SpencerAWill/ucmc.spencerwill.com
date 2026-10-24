---
paths:
  - "apps/ucmc-web/src/features/gear/**/*loan*"
  - "apps/ucmc-web/src/features/gear/**/*checkout*"
  - "apps/ucmc-web/src/features/gear/**/*checkin*"
  - "apps/ucmc-web/src/features/gear/components/gear-desk-*"
  - "apps/ucmc-web/src/features/gear/components/due-date-picker.tsx"
  - "apps/ucmc-web/src/features/gear/components/my-gear-list.tsx"
  - "apps/ucmc-web/src/features/gear/lib/availability.ts"
  - "apps/ucmc-web/src/features/gear/lib/counted-stock.ts"
  - "apps/ucmc-web/src/features/gear/lib/desk-units.ts"
  - "apps/ucmc-web/src/features/gear/server/gear-fns.ts"
  - "apps/ucmc-web/src/server/gear/**"
  - "apps/ucmc-web/src/routes/gear.loans.*"
  - "apps/ucmc-web/src/routes/my.gear.index.tsx"
  - "apps/ucmc-web/src/lib/weekdays.ts"
  - "apps/ucmc-web/src/lib/club-days*"
  - "apps/ucmc-web/e2e/gear-*loans.spec.ts"
---

# Gear loans, standing, and the desk's refusals

Part of the gear rule; `gear/core.md` holds the data model this builds on.

## Gear cave standing

`src/server/gear/gear-cave-standing.server.ts` — `good` / `flagged` /
`blocked`, derived from open overdue loans against two thresholds.

**Scoped to the cave, not named "member standing".** The club may grow
other standings (trips, dues, training) answering to different rules; a
single global "standing" would either collapse them or need renaming
later under more pressure.

It lives in `src/server/` rather than the gear feature because three
callers need it and features can't import each other — the desk blocks
checkout on it, `/my/gear` renders the member's own banner, and trips
will want it. **Derived, never stored:** storing it would need a cron to
keep it true and a way to disagree with the loan table.

Thresholds are **site settings** (`gear.overdueFlagDays`,
`gear.overdueBlockDays`), so the cave tunes them without a migration.
Defaults are 7 and 21 — one and three missed Wednesday return windows.
A block threshold below the flag threshold is honoured rather than
rejected, so the stricter still governs. Days are **whole club days in
`CLUB_TIME_ZONE`**, not elapsed hours: due dates are stamped
end-of-day, so "one day overdue" must mean a calendar day has turned.

Checkout consults standing **once per batch**, not per item — it is a
property of the borrower. The `gear:manage` override is deliberate and
audited rather than absent: the grant that can retire gear can also
decide "let them take the rope anyway", and the system should record
that rather than prevent it.

### The desk overrides

`overrideStanding` (a blocked member) and `overrideHolds` (a held piece)
are the only two refusals an officer can push through; `SKIP_OVERRIDE_FLAG`
in `lib/availability.ts` is the table, and everything absent from it is a
hard stop. Both are **`gear:manage`-gated inside the action**, not by the
`requireGearLoanManager` gate that admits the caller: `gear:loan` is
delegable to a keeper who holds nothing else, so reading either flag raw
would hand that keeper the override. Both land in the `loan.checked_out`
metadata on every row of the batch.

The affordance appears in the checkout pane **only after the server has
actually refused something**, below the batch rather than per row — a
blocked member refuses every row at once, and a per-row button would
invite clicking through the same decision six times. The retry submits
only the overridable rows, so a hard-stop row stays on screen with its
reason instead of being swept along.

## Loans are dual-shape

Each loan names **either** a coded item (`item_id`) **or** a counted model with a quantity (`model_id` + `quantity`, "six draws"). A CHECK constraint enforces exactly one. Every read path LEFT JOINs items and resolves the model through `coalesce(loans.model_id, items.model_id)` — one query serves both kinds, rather than two near-identical tables and two of every query behind `/my/gear`, the overdue list and member standing.

Counted loans support **partial return**: `quantity_returned` climbs as units come back, and the last unit closes the loan.

- **A short return leaves the loan open — and overdue-able — for what is still out.** "Five of six came back" is far likelier a sixth in somebody's pack than a loss, so nothing is written off at the desk; it is the same call sweeps make ("a shortfall is reported, the write-off stays somebody's decision"). `recordCountedReturn` is one guarded `UPDATE … SET quantity_returned = quantity_returned + n … WHERE quantity_returned + n <= quantity RETURNING`, not a read-modify-write: two officers each taking three draws back from one loan would otherwise both write 3 and lose a return. SQLite evaluates every SET against the pre-update row, which is what lets the `CASE` that stamps `returned_at` see the old count.
- **`writeOffLoanShortfallAction` is the only way a counted loan closes short** — `gear:manage`, a required reason, audited as `loan.written_off`, the units still out written into `quantity_lost`. It is gated like the overdue extend because it is the same escape: closing the loan clears the borrower's standing on it. **The lost units also come off serviceable stock, in the same D1 batch.** Stock counts every unit the club owns, and `takeable` is serviceable minus what is out — so closing the loan alone moves the lost draws from "out" back to "available" and the desk starts lending draws at the bottom of a river. The decrement reads the loan's outstanding units _before_ the close, inside the batch's transaction, and evaluates to zero if the loan is already closed, so a concurrent return or a second write-off can't double-count. Resolved against the real principal; a desk keeper gets `requires_manage`. The door is the **Write off** button on `/gear/loans/$publicId`, shown only for an open counted loan and gated on `hasPermission("gear:manage")`; the detail card shows "Returned _n_ of _m_" for counted loans and the list card says how many are still out. **Branch on `LoanSummary.isCounted`, never on `code === null` or `gearPublicId === null`** — an untagged coded piece has neither, and would read as counted. The write-off dialog stays mounted while open, not only while the loan qualifies: the success refetch closes the loan, and unmounting there would drop the mutation's onSuccess. **Counted only** — a coded piece that never came back is a `missing` whereabouts on a named unit, which a write-off would erase.
- **A counted check-in row names the loan, not the model** (`loanPublicId` + this return's `quantity`, not a running total). Two members can have the same draws out, and "three came back" has to land on somebody's loan. There is **no condition-at-return** on a counted row: one condition for six draws says nothing about which has the sticky gate, and stock buckets are corrected by counting the bin, not inferred from a return.
- `loan.checked_in` for a counted row carries `level: "model"`, this return's units, the running total and `closed`, so "3 of 6, 1 still out" reads straight off the audit page.
- **Backfill stays coded-only.** `bulkImportLoansAction` resolves rows by code; a CSV column for counted quantities is its own piece of work and nobody has asked for it.

**The partial unique index `gear_loans_one_active_per_item` on `(item_id) WHERE returned_at IS NULL` is the race protector — the per-row pre-check in the action is UX only.** It applies to coded loans only. Deactivating on-loan gear is blocked (typed `on_loan` result; the FK is also `RESTRICT`).

**Counted stock is guarded by a conditional insert, `insertCountedLoanIfAvailable`** — `INSERT … SELECT … WHERE serviceable − outstanding − held >= quantity`, one statement. There is no unit to make unique, so an index can't do it; a read-then-write can over-lend under a true tie (two officers each see six draws and each hand out six). D1 runs one statement at a time against a single SQLite writer, so the subqueries and the insert are atomic with respect to every other write — no lock, and nothing stored that could disagree with the loan table. #223 weighed accepting the over-lend (the old note here) and chose this because it costs one statement. The availability SQL repeats `takeable`'s arithmetic and `liveWhere`'s hold window: it has to run inside the insert, so it can't call either. If they drift, the desk refuses what browse promised. **Everywhere else `takeable` is `countedTakeable()` in `lib/counted-stock.ts`** — browse, the models dialog, the desk lookups and the refusal message — so the SQL copy is the only second definition. The checkout and check-in row schemas in `gear-fns.ts` are `satisfies z.ZodType<…RowInput>` against the action's hand-written types, so a field added to one and not the other fails to compile.

- **Checkout input is a per-row union** (`kind: "coded" | "counted"`), not per request: a real batch is "a harness and six draws". The discriminant is **required on both arms** — optional, a counted row missing its tag falls through to the coded arm and fails as `not_found`. The boundary refuses the same piece or model twice in one batch.
- **Two refusals are counted-only.** `insufficient_stock` (the shelf is short, holds aside) is a **hard stop** — `overrideHolds` lets the held units go, never units that aren't there. `on_hold` is reported only when the shelf _would_ cover it without the hold, so the override affordance appears exactly when overriding can work. A refused row carries `available` so the desk can say "only 4 left".
- `loan.checked_out` carries **`level: "item" | "model"` and `quantity`** — the vocabulary batch inspections already use — so a six-draw loan reads differently from one harness.

`LoanSummary.gearPublicId` is **nullable** — a counted loan has no item page to open. `<LoanSubjectLink>` owns that branch, because an `<a>` with no `href` still reads as a link.

Officer-only flows gate on `gear:loan` (separate from `gear:manage` so a "gear cave keeper" role can be delegated independently); `/my/gear` is member-self-read on `gear:read` plus an in-action borrower filter.

### Loan length is a site setting

`gear.defaultLoanDays` (default 7) is what the desk prefills; the officer still overrides per row, and `MAX_LOAN_DURATION_DAYS` (90) stays a code-enforced ceiling at checkout rather than a second knob. Leaving duration a constant while the overdue thresholds beside it were tunable was the inconsistency #224 called out — a setting needs no migration and a column does.

`DEFAULT_LOAN_DURATION_DAYS` survives as the **fallback the sheet shows before the query resolves**, not as the policy. The two numbers must agree, and `loan-duration.test.ts` pins the constant against the registry default so neither can be tidied in isolation — if they drift, the officer watches the prefill jump on load, which reads as a bug in the sheet rather than a mismatch between two files.

It is read through a **`gear:loan`-gated** server fn, not the public settings snapshot: loan length is officer-facing configuration, and that allowlist exists precisely so a setting can't go public by being reclassified. The pane adopts the configured value only while the officer hasn't touched the control, so a late response can't overwrite a deliberate choice.

**Still club-wide, not per-type.** `gear_types` already owns `inspection_interval_days`, so a `default_loan_days` column beside it is coherent the day officers ask for tents at 14 and harnesses at 7 — it is not built on speculation.

### The cave's open days move the PREFILL, and nothing else

The cave is open about two hours a week, so for every weekday except Wednesday `checkedOutAt + 7` named a day the member could not return on: they went overdue Wednesday morning and the first moment a door was open was that evening. The reminder ladder is what made it audible — an overdue email nobody can act on (#242).

**`computeDueAt` was deliberately not touched.** The fix is a _default_, not a rule: `defaultLoanDurationDays` (in `lib/loan-duration.ts`) rolls `gear.defaultLoanDays` forward to the first day in `gear.caveOpenDays`, the desk prefills that, and **the server stores exactly what the officer submits**. The wire format is still `durationDays`, so there is no "did they mean it?" flag to get wrong, and extensions, `bulkImportLoansAction` and every historical row keep the dates they already had. Off-cycle checkouts and returns stay entirely possible — this is about what the system _defaults to_, never what it permits.

Rolling is **forward-only**, so a Tuesday checkout becomes 8 days rather than 6: the member keeps the week they were promised plus the wait for a door. Three cases pass straight through — `durationDays <= 0` (the exec-meeting loan-and-return, handed back in the room), no open days configured (the summer, when `gear.caveHoursNote` goes blank beside it), and a roll that would breach `MAX_LOAN_DURATION_DAYS` (checkout clamps to the ceiling, so the rolled value would just be clamped back onto a shut day).

`DueDatePicker` takes `caveOpenWeekdays` and renders an **advisory line**, never a rewrite or a refusal: the officer's pick and the submitted value must agree about what was just agreed with the member, and an off-cycle return is often arranged on purpose. `text-muted-foreground`, not `text-destructive`.

**`gear.caveOpenDays` is free text (`"Wed"`, `"Mon,Wed"`), parsed by `parseWeekdayList` in `src/lib/weekdays.ts`** — the registry's `.refine()` and every reader share that one definition of valid. It is a string rather than a weekday array because `SettingRow` renders scalars and `autoFormType` answers `"unknown"` for anything else, with no branch behind it: an array would render `String(value)` into a text input and compare drafts by reference. `auto-form-type.test.ts` pins that **every** setting is renderable, so the next person to want a non-scalar finds out that the registry's reserved `editor` slot has to be built first.

**Weekday numbers are ISO (Mon = 1 … Sun = 7), matching `Temporal.dayOfWeek`.** `Date.prototype.getDay()` is Sunday-0 and agrees with ISO on every other day, so a mixed-convention bug is invisible until somebody configures Sunday. `isoWeekdayFromDate` is the only sanctioned conversion, and both `weekdays.test.ts` and `due-date-picker.test.tsx` carry a Sunday case for exactly this reason.

**Reads are fail-open, and that is not the same as "blank".** A garbage row never reaches `parseWeekdayList` — `readSetting` falls back to the schema default first — so an unparseable value keeps the configured Wednesday rather than degrading to "no open days". Blank is a _real_ configuration meaning the cave has no hours at all, so answering it on a bad read would silently switch the roll-forward off.

### Extending an overdue loan is an override

Standing is `daysOverdue(dueAt, now)`, so pushing a due date out resets it — a **one-day** extension on a rope thirty days late turns a blocked member back into a good one. That made "extend" the silent escape hatch from the entire overdue apparatus, and it is what the reminder ladder would otherwise leak through.

`extendLoanAction` therefore takes the shape checkout already uses for blocked standing and live holds: routine for a not-yet-due loan (`gear:loan`, the delegable desk tier), an explicit `gear:manage` override with a reason once the loan is overdue, both recorded in the `loan.extended` audit metadata (`wasOverdue`, `overrideOverdue`, `overrideReason`, `priorReminderStage`). The flag is resolved against `principal.permissions` on the **real** principal, like the checkout overrides — a desk keeper can't inherit it and emulation can't fake it. A `gear:manage` holder who doesn't _ask_ for the override is refused too: it is a judgement made on purpose, not one fallen into by clicking Save.

**Extending resets `reminder_stage` to `none`** (but not `last_reminded_at`, which is a historical fact). The ladder only climbs, so a loan left at `flagged` would stay silent for its whole extension and then jump straight back to `flagged` — the member would never be told about the date they were actually given.

**There is still no cap on length or count for a not-yet-due loan.** `MAX_LOAN_DURATION_DAYS` stays checkout-only. That is a deliberate scoping call from #224, not an oversight: the standing escape is what made the ladder meaningless, and a length cap barely touches it.

### The loans list toolbar

`/gear/loans` uses the shared `<DataToolbar />` like `/gear` and `/members`; the bespoke two-row `LoanFilterBar` is gone. Three loans-specific decisions:

- **The Active/History tabs sit above the toolbar, not in it.** They pick which dataset is on screen; every toolbar slot narrows the one already picked. The connected group's value is that its controls are in the same place on every list page.
- **Sorting carries a direction**, and the per-key default is in `lib/loan-sort.ts` (`due_at` → `asc`, so most-overdue-first; `checked_out_at` → `desc`). The contract lives in `lib/` rather than beside `listLoans` because the repo applies it, the route puts it in the URL and the toolbar offers it — and two of those three are client code. The route omits `dir` from the URL whenever it matches the default, so a shared link carries only what the sender actually changed.
- **The "Overdue only" chip is suppressed on the History tab**, where its checkbox is hidden — otherwise a tab switch strands a chip with no control behind it and a filter count nobody can clear.

### Backfill

`LoansBulkImportSheet` (header "Backfill" button on `/gear/loans`, gated by `gear:loan`). `bulkImportLoansAction` reads CSV, resolves members by primary email through `user_emails` and items by `code`, and supports open and pre-returned rows in the same import.

**Eligibility checks for `status` and `condition` are intentionally relaxed** — a piece retired today may have been serviceable when loaned years ago. The partial unique index still gates open backfill rows, surfaced as an `already_on_loan` skip. Audit events carry `bulk: true, backfill: true`. **Backfill does NOT mutate an item's `condition` from `condition_at_return`** — the historical condition belongs on the loan row only.

Gear bulk import **creates models on demand** from a `model` / `model_name` CSV column, so a sheet of forty draws lands on one model rather than forty. **The model name is the required cell** — a row naming no product is the one the parser refuses. The legacy `description` / `notes` header is still _read_, but only as a fallback product name for a sheet predating the `model` column; **nothing is stored from it**, since items carry no text of their own. The import sheet has no description field.
