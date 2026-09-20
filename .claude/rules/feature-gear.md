---
paths:
  - "apps/ucmc-web/src/features/gear/**"
  - "apps/ucmc-web/src/routes/gear.*"
  - "apps/ucmc-web/src/routes/my.gear*"
---

# Gear inventory, loans, and carts

## Three levels: type → model → item

The cave owns fleets, not one-offs, so the product is modelled separately from the physical unit.

- **`gear_types`** — the browse category ("Quickdraw", "Harness"). Owns the code prefix and a default `inspection_interval_days`.
- **`gear_models`** — the product ("BD HotForge 12cm"). Owns everything true of every unit: `manufacturer`, `msrp_cents`, `service_life_years`, the product image, and **`tracking`**.
- **`gear_items`** — one physical unit: `code`, `serial_number`, `manufactured_at`, acquisition, and the three state axes.

`manufacturer` / `msrp_cents` moved **off** the item onto the model — retyping "Black Diamond" onto forty rows was the old shape, and it's why "7 of 12 available" and recall-matching weren't answerable. **An item has no `description` at all** (dropped in migration `0069`). Its display name is derived — `gearItemName(model)`, manufacturer plus product name — and per-unit prose lives in `notes_markdown`, which is searchable and renders on the detail page. The column went because it duplicated `notes`, not the model: two short free-text fields on one row left officers guessing which one "buckle replaced in 2024" belonged in. In practice it also held the product name, since before the model layer it was the required catch-all for name, size and notes — every read path already coalesced it to the model name when empty, so the displayed name was half typed and half derived depending on whether an officer had filled a field the form used to insist on.

**Coded vs counted (`gear_models.tracking`).** Quickdraws and pre-cut slings carry no labels — the desk hands out six and counts six back. A `counted` model has **no item rows at all**; `gear_stock_levels` holds a quantity per condition bucket. Giving each draw a row anyway was fake precision: when five of six come back, nothing knows which one is gone. `tracking` lives on the **model**, not the type, so a special alpine draw set can be coded while everyday draws stay counted.

**Stock is written by `setGearModelStockAction` — the Stock button beside Edit on a counted model's row.** It takes absolute quantities per bucket, because that is the shape the answer arrives in: somebody counts the bin and types what they saw. The delta lives in the audit row (`gear_model.stock_adjusted`), which records only the buckets that actually moved. Until it existed, `gear_stock_levels` was read by browse, the model list and the sweep reconciliation and written by **nothing at all**, so marking a model `counted` was a dead end — no items allowed, no quantity enterable, "0 takeable" forever.

- **A serviceable count below the open loan quantity is refused** (`below_on_loan`, with the number). Stock counts every unit the club owns, the ones out with members included, and `takeable` is serviceable minus what is out — so a lower count would clamp `takeable` to zero and disagree with the loan table about how many draws the club has.
- **The editor shows `onLoan` and `onHold` beside the boxes** (both on `GearModelSummaryDto`, zero for coded models). "38 serviceable" reads as a shelf count unless the six that are out are on screen next to it, and without them the refusal above looks arbitrary.
- Buckets the caller omits are left alone, matching `attributes: undefined` on a model edit. The editor sends all three; an omission means "no change", not "zero".

## Three state axes, not one column

The old `lifecycle` + `condition` pair mixed three questions. They are now independent:

| Column        | Values                                     | Question                       |
| ------------- | ------------------------------------------ | ------------------------------ |
| `status`      | `active` · `retired` · `lost` · `disposed` | Is it still club property?     |
| `condition`   | `serviceable` · `needs_repair` · `unsafe`  | Can it be loaned?              |
| `whereabouts` | `cave` · `repair` · `officer` · `missing`  | Where is it, when not on loan? |

Loan state is **derived from `gear_loans` and never mirrored** onto the item — one source of truth for checkout.

- `missing` + `needs_repair` is legal (it was already broken when it vanished). The old single column couldn't say this.
- `missing` is the only state **inferred from absence**, at the close of an inventory sweep, which is why `whereabouts_as_of` exists. An item on an open loan is legitimately absent and can never be marked missing.
- `unsafe` is a hard loan block with **no override**. `needs_repair` is overridable by an officer with a confirm.
- Only an inspection may raise `condition`; anyone can lower it at check-in.
- Display labels live in **`lib/labels.ts`**, not per-component — six private copies had already drifted. So does **`isTerminalStatus`**: "is this still club property" is `status !== "active"`, and every surface that spelled it `status === "retired"` silently excluded `lost` and `disposed`, offering "Retire" on an item already written off and no way back to active. The inverse action is **"Reactivate"**, which is accurate for all three.
- **`availabilityBadge` reaches past the rollup for the terminal bucket.** `gearAvailability` collapses all three terminal statuses into `retired` — right for "can I borrow this", wrong as the word on a card, where a lost harness read "Retired". The rollup keeps its five values (the filter is built on them) and the badge names the raw status. It reaches past `on_loan` too, for the same kind of reason: a loan whose date has gone reads **"Overdue"**, destructive, matching what `/gear/loans` and `/my/gear` already said about the same row.
- **`availabilityNote` is the half-sentence beside the badge** — "back Sep 23", "was due 2 weeks ago", the hold's reason, or where the piece is. `Unavailable` alone was the entire story for a piece at the shop, missing, or out with an officer: exactly the three cases with no condition badge next to them to account for it.

## Codes are never recycled

`gear_items.code` is nullable (an unlabelled fresh-in-box item) and **absolutely unique**. **Deactivating does NOT null it** — the label stays bound to that item forever, so every historical "CH93" in a note, logbook or audit row resolves to exactly one thing.

- **`listCodesForType` is deliberately unfiltered by status.** It used to consider only active gear, which was safe _only because_ retiring nulled the code. Filtering now would suggest a code the unique index then rejects.
- `suggestCode` is `max + 1` and advisory — an officer may type anything. The client helper in `lib/suggest-code.ts` mirrors the server action.
- Freeing a code is an explicit, audited **`releaseGearItemCodeAction`** on an already-deactivated item. Refused on an active item. That is the whole recycling story — not a mode the system runs in.
- Retired items **appear** in code search and at the desk, flagged ineligible: scanning a retired harness should say "retired, do not loan", which beats "not found".

**`reactivateGearAction` preserves `deactivated_reason`.** The old un-retire nulled it, destroying the record of _why_ a harness was pulled the moment someone reversed the call.

## Permissions

Browse is `gear:read` (auto-granted to `role_member`); create/edit/deactivate/import, **models, holds, sweeps and attribute definitions** all need `gear:manage`. Recording an inspection needs **`gear:inspect`**, checked as `gear:inspect || gear:manage` in `requireGearInspector` so a trip leader can log a failed rope without authority to retire or bulk-import; seeded ungranted, to be delegated at `/access`.

**The new surfaces deliberately introduce no permissions of their own.** They are the same officer surface as the items they group, and a permission costs a migration plus a seed plus a role grant — worth spending only when a surface can be delegated separately, which none of these can.

Tags render through **`GearTagChip`**, not `Badge`: a notched luggage-tag silhouette with an eyelet, muted fill, no border. They used to be pills prefixed with `#`, and the hash was the only thing separating them from the state chips beside them — so removing it (they are chips, not hashtags) meant the difference had to move into the shape. A tag is a label somebody chose to stick on; `Available` and `Needs repair` are facts the system derived, and the two should not look alike.

Tags have a `visibility` column (`public`/`internal`) — **internal tags are stripped at the repo layer for non-officers, not just in the UI.** Tags are for multi-valued, cross-cutting labels (`dry-treated`, `instruction-only`). Per-type scales like harness size belong in `gear_attribute_defs`: tag names are globally unique (one `"M"` shared by harnesses and jackets) and the tag filter is **AND-only**, so "M or L" as tags returns nothing.

## Custom attributes, at two levels

Officer-defined attributes scoped to types via `gear_attribute_def_types` (a join table, so `Colour` is defined once and attached to many types). `level` is `model` or `item`: rope diameter is typed once for a fleet of forty, harness size varies per unit. A counted model has no items, so only model-level values can exist for it — that falls out of the shape rather than needing a rule.

Four kinds: `text`, `number`, `select`, `boolean`. **The unit lives on the definition, never in the value** — a value of `"60m"` is text and stops being range-filterable, which defeats the point. **`select` options carry explicit ordering**; sorting sizes alphabetically yields `L, M, S, XL`.

Values live across two columns, and which one a kind uses is decided **once**, in `coerceAttributeValue` (`lib/attributes.ts`): numbers and booleans in `value_number` (booleans as 0/1, matching every other boolean in the schema), text and select in `value_text`. The forms, the facets and the detail card all read that same function, so a value written by one surface reads back identically in the others.

Three rules are enforced in `attributes-actions.server.ts` rather than the schema, because all three are about intent rather than integrity:

- **`key` is derived once from the label and never re-derived.** It is what every stored value points at; re-deriving on a relabel would orphan them all. Renaming "Size" to "Harness size" keeps `size`.
- **`kind` and `level` are immutable after creation.** Flipping a select to a number leaves every answer in the wrong column, and model → item can't say which item inherits the fleet's answer. Archive and redefine. The manage dialog shows both read-only on edit rather than letting a save fail.
- **Deleting a def with answers against it is refused** (`has_values`, with the count). The FK cascades, so the database would take every answer with it. Archiving is the reversible door and sits in the same row.

**Archiving is a soft delete that keeps values readable.** Archived defs drop off the forms and facets but their recorded answers still render — an answer that was given is still true, and hiding it the moment someone archives the question makes the detail card quietly lie. Detaching a type likewise does **not** delete values.

Officers manage definitions from the **Attributes** button on `/gear`, beside Types and Tags. Model-level answers are collected in the inline model-creation panel of the add-gear sheet; item-level ones render in the sheet itself, keyed off the selected type.

`resolveAttributeWrites` is the one path from a submitted form to the value tables, shared by the item and model actions:

- **Definitions the caller didn't mention are left alone.** The item form renders item-level defs for one type and must not wipe an answer belonging to a def it never showed — which is also why `attributes: undefined` on edit means "no change", matching `serialNumber` and `thumbnailDataUrl`. Editing from the list (a `GearSummary`, which never carried the answers) therefore leaves them intact.
- **Definitions mentioned but not attached to this type, or archived, are ignored rather than rejected.** A form submitted moments after somebody detached a type is stale, not malicious.
- **`required` is enforced whether the field arrives blank or not at all**, so omitting it isn't a way around the rule. Validation runs **before** the insert and the thumbnail upload, so a refused value can't leave a half-made item behind.

## Attribute facets on the gear page

Once a type is selected, the toolbar grows one filter per `select` or `boolean` definition attached to it. **Free text and number kinds get no facet** — free text would list four hundred distinct answers, and a number wants a range, which belongs with the browse-by-model redesign.

- **Values within one facet are OR'd; separate facets are AND'd.** This is the opposite of the tag filter, and deliberately: a tag is a label somebody chose to stick on, while an attribute answers a fixed question, so two values of the same question are alternatives. "M or L" works here and returns nothing as tags.
- **Facets appear only with a type selected.** Unscoped, the list would be every question the club has ever asked, most of them meaningless for most rows.
- **Changing the type clears the selections.** Left in place they would AND against the new type's rows and return nothing, with no chip visible to explain it.
- The filter is one clause per facet, each an `EXISTS` against **both** value tables OR'd together. The repo isn't told which level a definition lives at, and since a def only ever has rows in its own level's table, the union is exact rather than a guess.
- URL shape is a repeated `attr=<defPublicId>:<value>` param, split on the **first** colon so a value containing one ("1:1 taper") round-trips. Malformed or unknown entries are dropped, never refused: a shared link outliving its definition should widen the list, not break the page.

**Bulk import does not enforce `required`** — it calls `insertGearItem` directly rather than going through `createGearAction`, and predates attributes entirely. A CSV of forty harnesses lands with no size answered even where size is required.

## Availability is the rollup members browse by

`lib/availability.ts` collapses the four axes into one answer to "can I
take this out?". Precedence is deliberate and written down there:
terminal status → open loan → condition/whereabouts problem → hold.

- **`on_loan` deliberately outranks a condition problem.** An open loan
  resolves on a known date, and the borrower is often the person who
  reported the damage at check-in; "back Thursday" beats "needs repair".
- **A hold ranks last** of the blocking states — it is the softest,
  officer-overridable and self-expiring.
- **`availabilityWhere` in `repo.server.ts` is the SQL mirror** of the
  same function and must stay in step with it. A disagreement shows up
  as a row filtered to "Available" wearing an "On loan" badge. The
  filter is pushed into SQL rather than applied to a fetched page,
  because filtering after the fact returns short pages and a lying
  total — **and the count query must carry the same joins as the row
  query** or it fails on an unknown column.
- The list query LEFT JOINs the open loan and **the earliest-ending live
  hold via a correlated subquery**. The subquery is the fan-out guard:
  two overlapping holds on one item would otherwise duplicate its row.

`blockedReason` answers a different question from availability — it is a
property of the _pairing_ of member and item, not of the item. A
greyed-out button with no explanation is the classic complaint about
club gear systems, so every refusal carries a message.

**`itemBlockedReason` is the item's half of it** — everything decidable
from the row, with no member attached; `not_waiver_current` and
`has_overdue` are the viewer's half and are decided server-side. It is
what `AddToCartButton` disables on, and the message is what it shows. The
button previously gated on terminal status and a null code only, so a
member could cart an unsafe harness, one at the repair shop or one
already out with somebody and hear about it at the desk — while the
messages written for exactly that moment sat unreferenced outside their
own unit test. **A piece short of terminal keeps its control and says
why**; only a terminal one loses it, because "you can't borrow this"
under every row of a retired list is noise rather than an answer.

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

Counted loans support **partial return**: `quantity_returned` climbs as units come back; the shortfall lands in `quantity_lost` when the loan closes.

**The partial unique index `gear_loans_one_active_per_item` on `(item_id) WHERE returned_at IS NULL` is the race protector — the per-row pre-check in the action is UX only.** It applies to coded loans only; counted stock is guarded by an available-quantity read-then-write that can over-lend by one under a true tie, which the cave prefers to taking a lock. Deactivating on-loan gear is blocked (typed `on_loan` result; the FK is also `RESTRICT`).

`LoanSummary.gearPublicId` is **nullable** — a counted loan has no item page to open. `<LoanSubjectLink>` owns that branch, because an `<a>` with no `href` still reads as a link.

Officer-only flows gate on `gear:loan` (separate from `gear:manage` so a "gear cave keeper" role can be delegated independently); `/my/gear` is member-self-read on `gear:read` plus an in-action borrower filter.

The **gear-desk Sheet** hosts checkout and check-in behind a tab toggle. An earlier mobile FAB iteration was dropped because the FAB's fixed positioning fought the sidebar's stacking context.

Audit actions: `loan.checked_out` (one per row, `bulk: true`), `loan.checked_in`, `loan.extended`, `loan.cart_scanned`. Gear-side: `gear.added`, `gear.updated`, `gear.deactivated`, `gear.reactivated`, `gear.code_released`, `gear.tags_changed`, `gear_model.*`. **`gear.retired` / `gear.unretired` remain in the enum for historical rows only** — nothing emits them.

**The audit action list exists twice** — `auditAction` in `drizzle/schema.ts` (the column enum) and `AUDIT_ACTIONS` in `features/audit/server/audit-fns.ts` (the filter dropdown). Nothing keeps them in sync; add to both.

### Barcode scanning is hand-rolled

Native `BarcodeDetector` on Chrome / Edge / Android Chrome / Safari iOS 17+ / Safari macOS 17+ (zero deps, zero WASM), with a `barcode-detector/ponyfill` fallback for Firefox / pre-17 Safari. **The ZXing WASM the ponyfill needs is vendored locally** at `public/zxing-wasm/zxing_reader.wasm` and served same-origin via `prepareZXingModule({ overrides.locateFile })` so `connect-src 'self'` stays sufficient. Format whitelist is `["code_128", "qr_code"]`. CSP needs `script-src 'wasm-unsafe-eval'`; `Permissions-Policy: camera=(self)` is scoped to `/gear/loans*` only (`server/headers.server.ts` `securityHeadersForPath`).

### Backfill

`LoansBulkImportSheet` (header "Backfill" button on `/gear/loans`, gated by `gear:loan`). `bulkImportLoansAction` reads CSV, resolves members by primary email through `user_emails` and items by `code`, and supports open and pre-returned rows in the same import.

**Eligibility checks for `status` and `condition` are intentionally relaxed** — a piece retired today may have been serviceable when loaned years ago. The partial unique index still gates open backfill rows, surfaced as an `already_on_loan` skip. Audit events carry `bulk: true, backfill: true`. **Backfill does NOT mutate an item's `condition` from `condition_at_return`** — the historical condition belongs on the loan row only.

Gear bulk import **creates models on demand** from a `model` / `model_name` CSV column, so a sheet of forty draws lands on one model rather than forty. **The model name is the required cell** — a row naming no product is the one the parser refuses. The legacy `description` / `notes` header is still _read_, but only as a fallback product name for a sheet predating the `model` column; **nothing is stored from it**, since items carry no text of their own. The import sheet has no description field.

## Member cart (`/my/gear/cart`)

Each approved + current-waiver member has a personal pre-checkout cart so they can tag items online and present a QR at the cave instead of dictating codes at the desk.

**Storage is KV-only — no D1 table, no per-item reservation.** `gear-cart:user:<userId>` holds the live cart with a 24 h TTL (refreshed on every mutation); a separate `gear-cart-token:<uuid>` holds a snapshot at QR-generation time with a 5 min TTL. The QR encodes `ucmc-cart:<uuid>` — the desk scanner branches on the prefix to call `resolveCartTokenFn` instead of `getItemByCode`, and **the _snapshot_ (not the live cart) is what resolves**, so a post-mint edit doesn't drift the officer's view.

Member writes go through `requireCartMember` (approved + current-cycle waiver attestation); `resolveCartTokenAction` is officer-only (`gear:loan`) and emits `loan.cart_scanned`.

Hydration computes per-row `availability` (`loanable` / `on_loan` / `not_serviceable` / `retired` / `not_found`) so the cart page can flag unavailable items inline AND the desk pane can block submit until they're removed. **The status check is `!== "active"`, not `=== "retired"`** — a `lost` or `disposed` item is equally un-loanable.

**Cart membership is not audited** — it's a private, ephemeral surface; only the officer scan creates an audit row.

QR rendering uses the **`qrcode`** dep on a canvas inside `<CartQrDialog />`; `jsbarcode` owns linear-barcode label printing.

The "Add to cart" button is hidden for anonymous / non-approved viewers **and for officers operating gear admin tools (`gear:manage`)**. **Items without a `code` cannot be added** — the desk would have no scannable identifier even after a cart scan.

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

`gear_inspections` carries the same `item_id` / `model_id` XOR as loans, holds and sweep entries, and for the same reason: a counted model has no item rows, so "looked over all the draws" has nowhere else to hang. Both halves are reachable — a coded piece from the inspection log on its detail page, a counted model from the **Inspections** button beside Stock on its row in the models dialog.

- The write **refuses a coded model** (`not_counted`): its units are inspected one at a time, by code, and a batch row would record "all of them are fine" while saying nothing about which harness was in somebody's hands. The **read answers with an empty list instead** — a coded model has no batch history, which is a fact about it rather than a broken request.
- The audit row carries `level: "item" | "model"`, because otherwise a reader can't tell a batch check of forty draws from one harness.
- `GearInspectionFormDialog` and `GearInspectionList` are shared by both surfaces rather than copied per layer — an inspection reads the same either way.
- **Batch inspections are `gear:manage`-reachable only**, because the models dialog is. The action itself is `requireGearInspector` like the item path, so opening a counted-gear surface to `gear:inspect` is a UI change, not a permissions one. Known gap: a trip leader can log a failed rope but not a fuzzing sling.

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

## Not built yet

Counted stock is entered and reported, but **the desk still can't hand out a quantity** — checkout resolves a code, and the counted pane behind it is unbuilt. Nothing is marked `counted` until the cave names which models are. Reservations (member-initiated, converting into a loan at the desk), and qualification gating are deliberately deferred.

**No attribute definitions are seeded.** Which attributes exist, at which level, with which options in which order, is the cave's call — a guessed set would be worse than an empty one, because officers would edit around it rather than replace it.
