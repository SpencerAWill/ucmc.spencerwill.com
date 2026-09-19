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

`manufacturer` / `msrp_cents` moved **off** the item onto the model — retyping "Black Diamond" onto forty rows was the old shape, and it's why "7 of 12 available" and recall-matching weren't answerable. An item's `description` is now **optional** (per-unit distinguishing marks); the model supplies the name.

**Coded vs counted (`gear_models.tracking`).** Quickdraws and pre-cut slings carry no labels — the desk hands out six and counts six back. A `counted` model has **no item rows at all**; `gear_stock_levels` holds a quantity per condition bucket. Giving each draw a row anyway was fake precision: when five of six come back, nothing knows which one is gone. `tracking` lives on the **model**, not the type, so a special alpine draw set can be coded while everyday draws stay counted.

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
- Display labels live in **`lib/labels.ts`**, not per-component — six private copies had already drifted.

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

Gear bulk import **creates models on demand** from a `model` / `model_name` CSV column, falling back to the description when the column is absent, so a sheet of forty draws lands on one model rather than forty.

## Member cart (`/my/gear/cart`)

Each approved + current-waiver member has a personal pre-checkout cart so they can tag items online and present a QR at the cave instead of dictating codes at the desk.

**Storage is KV-only — no D1 table, no per-item reservation.** `gear-cart:user:<userId>` holds the live cart with a 24 h TTL (refreshed on every mutation); a separate `gear-cart-token:<uuid>` holds a snapshot at QR-generation time with a 5 min TTL. The QR encodes `ucmc-cart:<uuid>` — the desk scanner branches on the prefix to call `resolveCartTokenFn` instead of `getItemByCode`, and **the _snapshot_ (not the live cart) is what resolves**, so a post-mint edit doesn't drift the officer's view.

Member writes go through `requireCartMember` (approved + current-cycle waiver attestation); `resolveCartTokenAction` is officer-only (`gear:loan`) and emits `loan.cart_scanned`.

Hydration computes per-row `availability` (`loanable` / `on_loan` / `not_serviceable` / `retired` / `not_found`) so the cart page can flag unavailable items inline AND the desk pane can block submit until they're removed. **The status check is `!== "active"`, not `=== "retired"`** — a `lost` or `disposed` item is equally un-loanable.

**Cart membership is not audited** — it's a private, ephemeral surface; only the officer scan creates an audit row.

QR rendering uses the **`qrcode`** dep on a canvas inside `<CartQrDialog />`; `jsbarcode` owns linear-barcode label printing.

The "Add to cart" button is hidden for anonymous / non-approved viewers **and for officers operating gear admin tools (`gear:manage`)**. **Items without a `code` cannot be added** — the desk would have no scannable identifier even after a cart scan.

## Not built yet

The schema carries `gear_holds`, `gear_inventory_sweeps` (+ entries) and the four attribute tables; their actions and UI land in later steps. Model editing beyond inline creation from the add-gear sheet, reservations (member-initiated, converting into a loan at the desk), qualification gating, member-standing thresholds and the browse-by-model page redesign are all deliberately deferred.
