---
paths:
  - "apps/ucmc-web/src/features/gear/**/*model*"
  - "apps/ucmc-web/src/features/gear/**/*hold*"
  - "apps/ucmc-web/src/features/gear/**/*sweep*"
  - "apps/ucmc-web/src/features/gear/**/*inspection*"
  - "apps/ucmc-web/src/features/gear/**/*stock*"
  - "apps/ucmc-web/src/features/gear/lib/safety.ts"
  - "apps/ucmc-web/src/features/gear/server/repo.server.ts"
  - "apps/ucmc-web/src/routes/gear.index.tsx"
  - "apps/ucmc-web/src/routes/gear.$publicId.tsx"
  - "apps/ucmc-web/e2e/gear-inspections.spec.ts"
---

# Gear catalog: models, stock, holds, sweeps, inspections

Part of the gear rule; `gear/core.md` holds the data model and the availability rollup.

**Stock is written by `setGearModelStockAction` — the Stock button beside Edit on a counted model's row.** It takes absolute quantities per bucket, because that is the shape the answer arrives in: somebody counts the bin and types what they saw. The delta lives in the audit row (`gear_model.stock_adjusted`), which records only the buckets that actually moved. Until it existed, `gear_stock_levels` was read by browse, the model list and the sweep reconciliation and written by **nothing at all**, so marking a model `counted` was a dead end — no items allowed, no quantity enterable, "0 takeable" forever.

- **A serviceable count below the open loan quantity is refused** (`below_on_loan`, with the number). Stock counts every unit the club owns, the ones out with members included, and `takeable` is serviceable minus what is out — so a lower count would clamp `takeable` to zero and disagree with the loan table about how many draws the club has.
- **The editor shows `onLoan` and `onHold` beside the boxes** (both on `GearModelSummaryDto`, zero for coded models). "38 serviceable" reads as a shelf count unless the six that are out are on screen next to it, and without them the refusal above looks arbitrary.
- Buckets the caller omits are left alone, matching `attributes: undefined` on a model edit. The editor sends all three; an omission means "no change", not "zero".

## Managing models

`/gear` → **Models**, listing every product by default with the type select as a filter. It was originally scoped the way the add-gear picker is, holding the list back until a type was chosen — which opened the officer surface for the layer this rework introduced on a lone empty select, with no list, no count and no way to find a model whose type you'd forgotten. **Creating still wants a type**, because a model hangs off one. MSRP, service life, inspection cadence, product URL and the model-level attributes are all editable here — the inline creator in the add-gear sheet deliberately offers only name and manufacturer, because an officer adding the club's first pair of draws shouldn't have to fill in a product sheet first.

MSRP, service life, **date of manufacture**, inspection cadence, product URL and the model-level attributes are all editable here.

**A model is unique on `(type_id, coalesce(manufacturer, ''), name)`.** The `coalesce` is load-bearing: `manufacturer` is nullable and SQLite treats NULLs as distinct, so a plain three-column index let the same unbranded "Rope" be created twice under one type — two identical models with the items split across them. Blank collides with blank; "Petzl Rope" and an unbranded "Rope" stay distinct, because plenty of club gear genuinely has no brand recorded.

Two refusals are typed rather than left to the database: `has_items` on a coded → counted flip (counted stock is quantities, and the item rows would be stranded while still holding their codes and loan history) and `has_items` on delete (the FK is RESTRICT; the pre-check turns it into a message naming what to move first).

**An update writes the model row before its attribute answers**, so a rename that collides on the unique index refuses with nothing committed. The other order left a partial save behind a refused submit. **A model cannot change type** — `UpdateGearModelInput` omits `typePublicId` rather than ignoring it, because attribute definitions are scoped per type and a move would orphan every answer under the old one while the items kept codes carrying the old prefix.

## Holds

`/gear` → **Holds**. A hold reserves gear ahead of a trip without creating a loan: nobody has taken it, but the desk should stop handing it out. Dual-shape like loans — either a coded item or a counted model with a quantity, enforced by a CHECK constraint and pre-checked in the action so the form gets a message rather than a constraint error.

- **Holds are self-expiring and nothing sweeps them.** Every read filters on `released_at IS NULL AND starts_at <= now < ends_at`, so an officer who forgets to release one after the trip costs the cave nothing. `liveWhere` is written once in `holds-repo.server.ts` because the list, the per-item lookup and the quantity rollup must agree on it.
- **`now` is caller-supplied, not the database clock**, so the list, the availability rollup and the desk agree within one request and a test can pin it.
- **The reason is required and member-visible.** "Held for the Red River trip" is a real answer; "Unavailable" is not. `GearSummary.holdReason` is populated **only when the hold is what's actually blocking** — a hold sitting behind an open loan or a repair flag would otherwise explain the wrong thing.
- **Releasing is the only write besides placing — there is no delete.** A hold that ran its course is a record of what the cave did with its gear, and an expired hold can still be released: it changes nothing about availability, but it is how an officer says "this trip is over" rather than leaving a row that looks merely lapsed.
- **A quantity hold is refused on a coded model** — its units are held one at a time, by code, and a quantity would pick no particular piece and block nothing the rollup can see. Conversely `liveHeldQuantityForModels` excludes coded items, or the same unit would be subtracted twice.
- Officers name a piece **by its code**, case-insensitively (`getGearItemByCode`), because that is how the cave names pieces. The desk's own code search is separate: it gates on `gear:loan` and carries loan state.

## Inventory sweeps

`/gear` → **Sweep**, a Sheet rather than a dialog because a sweep is a standing session somebody works out of for an hour with a phone, not a form they dismiss.

**Presence is recorded; absence is inferred at close.** That inference is the only thing in the system that can decide a piece is `missing`, and it is why the sweep is an entity rather than a per-item checkbox: the close stamps _when_ the cave was last looked at, which is what `whereabouts_as_of` means.

- **One sweep is open at a time, cave-wide.** Two concurrent counts would each infer absence from the other's sightings and mark half the cave missing. A second `startSweepAction` returns `already_open` with the existing publicId rather than erroring — two officers both tapping Start is how a sweep begins.
- **Logging is idempotent** by the unique index on `(sweep_id, item_id)`. Several people working one sweep will scan the same harness; that is the normal case, not an error.
- **Untagged pieces are picked, not typed.** `gear_items.code` is nullable, and the scan box was the only way into a sweep — so an unlabelled piece could never be logged, went unseen at every close, and was marked `missing` permanently however plainly it sat on the shelf. `listUncodedSweepCandidatesAction` feeds a picker that logs by `publicId` instead. They are deliberately **not** excluded from the missing inference: the cave does want to know whether the untagged harness is still there, so the fix is a way to answer rather than a way to skip the question. The list is unscoped by type — uncoded items are the exception, so it stays short — and rows already logged this sweep stay listed with a tick.
- **For a counted model a later count replaces the earlier one** rather than adding to it. Two people each counting the whole bin is far likelier than two splitting it, and a wrong total that reads as a surplus is harder to notice than one that reads short.
- **Close excludes four things from the missing sweep**, each for its own reason: on an open loan (legitimately absent — marking it missing accuses the borrower of losing what they signed out), at `repair`, with an `officer`, and **under a live hold** (all three absent by arrangement). The hold exclusion was missed at first, which had the close calling a piece missing while the hold explaining its absence — with a named officer and a written reason — sat beside it in the same UI. An **expired** hold shields nothing, matching how it releases itself everywhere else. An item **already** `missing` is deliberately _not_ excluded: it is still unseen, and re-stamping is how "missing since March" stays true rather than freezing at the first sweep that noticed.
- **Counted shortfalls are reported, never written off.** `expected` is total stock; `counted + onLoan` is what the sweep accounts for. A miscount is likelier than four lost draws, so the write-off stays somebody's decision. A surplus is reported as nothing — it means a miscount upward or stale stock, neither of which is a loss to chase.

## Inspections, at both levels

`gear_inspections` carries the same `item_id` / `model_id` XOR as loans, holds and sweep entries, and for the same reason: a counted model has no item rows, so "looked over all the draws" has nowhere else to hang. Both halves are reachable — a coded piece from the inspection log on its detail page, a counted model from the **Inspections** worklist on `/gear`. The models dialog deliberately offers **no** inspection door: it is `gear:manage`, so a second entrance there would be the same log behind the stricter grant, and the two would drift.

- The write **refuses a coded model** (`not_counted`): its units are inspected one at a time, by code, and a batch row would record "all of them are fine" while saying nothing about which harness was in somebody's hands. The **read answers with an empty list instead** — a coded model has no batch history, which is a fact about it rather than a broken request.
- The audit row carries `level: "item" | "model"`, because otherwise a reader can't tell a batch check of forty draws from one harness.
- `GearInspectionFormDialog` and `GearInspectionList` are shared by both surfaces rather than copied per layer — an inspection reads the same either way.
- **Batch inspections ride on `gear:inspect`**, through the **Inspections** button on `/gear` — a worklist of counted models, stalest first, with their two safety clocks and no catalog affordances. They were briefly `gear:manage`-only because the models dialog was the sole door, which coupled a fuzzing sling to the grant that can retire gear and bulk-import stock — the exact coupling `gear:inspect` was seeded to break. It is the only door: managers reach batch inspections the same way an inspector does.
- **`listCountedModelsForInspectionAction` is deliberately narrower than `listGearModelsAction`** — no MSRP, no stock, no attributes, no product URL. A read that answers only "which bin, and when was it last looked at" is one that can be delegated without handing over the catalog. It is also sorted for the job rather than alphabetically: never-inspected first, then stalest.
- `MANAGE_ACTIONS` in `gear.index.tsx` carries a `permission` per entry and the bar renders when **any** of them passes, so an inspect-only officer sees one button and no "Add gear".

## The two safety clocks

`lib/safety.ts` — `inspectionState` and `serviceLifeState`. Both are **derived, never stored**: storing either would need a cron to keep it true and a way for it to disagree with the inspection log, the same reasoning that keeps loan state off the item row.

**Neither blocks checkout.** `unsafe` is the hard block and an inspection is what sets it; an overdue cadence means nobody has _looked_, which is a job for the cave rather than a refusal at the desk. Blocking on it would strand a club that fell behind over a summer — exactly when the gear most needs to keep moving. What these do is make the backlog filterable.

- **Cadence resolves model → type.** A dry rope may need looking at more often than ropes in general.
- **`never` is its own status, not a flavour of `overdue`** — a piece nobody has ever inspected and one a week late are different jobs. Likewise `unknown` service life (the model ages out, nobody read the tag) is distinct from `untracked` (it doesn't age out): one is a gap somebody can close, the other isn't a gap at all.
- **The service-life clock runs from `manufactured_at`, never acquisition.** A rope bought from old warehouse stock is as old as the day it was made.
- **It resolves item → model.** `gear_models.manufactured_at` (migration `0070`) is the batch date, and it is the only one a `counted` model can have: no item rows means no per-unit date, so before it existed a bin of ten-year slings reported `unknown` forever — which reads as "nobody checked the tag" when the truth was "there is nowhere to write it down". One date for the whole model, not a range, because the cave buys draws as a batch and a per-unit date is exactly the precision `counted` exists to stop faking.
- **Both clocks render on the counted model's row** in the models dialog, under the same `isSafetyFlag` rule the item list uses. `lastInspectedAtMs` on `GearModelSummaryDto` comes from `latestInspectionByModelIds` — the model-level mirror of the per-item read — and stays null for coded models, whose cadence is answered per unit.
- Thresholds: `DUE_SOON_DAYS` 14 (one meeting cycle plus slack) and `EXPIRING_SOON_DAYS` 365 (the point where replacement stops being an emergency and becomes a budget line). Constants, not site settings — nobody has asked to tune them yet.
- `isSafetyFlag` decides what gets a badge. `ok` and `untracked` are the quiet majority; badging them would make the list all badge and no signal.

**`inspectionWhere` / `serviceLifeWhere` in `repo.server.ts` are SQL mirrors** under the same keep-in-step rule as `availabilityWhere`, and `gear-safety-filters.test.ts` pins each filter against the status on the row it returns. One known divergence, documented at the function: the inspection filter does its arithmetic in milliseconds while `inspectionState` counts whole club-time calendar days, so they can differ by a day for a piece whose inspection timestamp falls within the UTC offset of midnight _and_ whose due date straddles a DST change. Reimplementing club-time date math in SQLite is the worse trade. Service life uses SQLite's own `date(..., '+N years')` so a leap day inside a ten-year life is a real day — but `date()` works in UTC, so `serviceLifeWhere` carries the same one-day drift for the same reason, now noted at the function alongside the inspection one.

## Browse by model

The `models` view on `/gear` — one card per product, with its units bucketed. This is what the type → model → item rework was _for_. The flat item list answers "where is CH93", which is an officer's question; a member asks "does the club have a harness I can borrow on Saturday", and twelve unrelated rows all reading "Black Diamond HotForge" cannot answer it.

- **The counts use the same `availabilityWhere` predicates** the item list filters by, summed as CASE expressions over the same joins. A fourth hand-written copy of the precedence would be a fourth thing to keep in step.
- **Coded and counted models render identically.** Whether the cave tracks a product unit by unit or by the binful is a bookkeeping decision, and a member borrowing six draws has no reason to learn about it. `takeable` is the one number both produce: available units for a coded model, serviceable stock minus out-on-loan minus held for a counted one.
- **Models with no units still appear.** Defined-but-unstocked is a real intermediate state during setup, and dropping the row would make the model look like it failed to save.
- **Picking a model sets a `model` filter and switches to the list view** — that is the step from "7 available" to a code somebody can ask for at the desk.
- `listGearModelBrowseAction` is **`gear:read`**, unlike `listGearModelsAction` (the officer admin list, `gear:manage`). The toolbar's model chip resolves its label through the browse read for that reason.
