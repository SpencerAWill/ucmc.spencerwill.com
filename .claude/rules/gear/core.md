---
paths:
  - "apps/ucmc-web/src/features/gear/**"
  - "apps/ucmc-web/src/routes/gear.*"
  - "apps/ucmc-web/src/routes/my.gear*"
  - "apps/ucmc-web/src/server/gear/**"
---

# Gear inventory, loans, and carts

The data model and the invariants every gear surface shares. The rest of the gear
rule is split by area and loads with the files it is about, all under
`.claude/rules/gear/`: `loans.md` (loans, standing, overrides, extend, backfill),
`desk.md` (the desk sheet, scanning, wedge, labels), `reminders.md` (the daily
ladder), `attributes.md` (custom attributes and facets), `catalog.md` (models,
stock, holds, sweeps, inspections, safety clocks, browse) and `cart.md`. Read the
relevant one before changing behaviour it covers.

## Three levels: type → model → item

The cave owns fleets, not one-offs, so the product is modelled separately from the physical unit.

- **`gear_types`** — the browse category ("Quickdraw", "Harness"). Owns the code prefix and a default `inspection_interval_days`.
- **`gear_models`** — the product ("BD HotForge 12cm"). Owns everything true of every unit: `manufacturer`, `msrp_cents`, `service_life_years`, the product image, and **`tracking`**.
- **`gear_items`** — one physical unit: `code`, `serial_number`, `manufactured_at`, acquisition, and the three state axes.

`manufacturer` / `msrp_cents` moved **off** the item onto the model — retyping "Black Diamond" onto forty rows was the old shape, and it's why "7 of 12 available" and recall-matching weren't answerable. **An item has no `description` at all** (dropped in migration `0069`). Its display name is derived — `gearItemName(model)`, manufacturer plus product name — and per-unit prose lives in `notes_markdown`, which is searchable and renders on the detail page. The column went because it duplicated `notes`, not the model: two short free-text fields on one row left officers guessing which one "buckle replaced in 2024" belonged in. In practice it also held the product name, since before the model layer it was the required catch-all for name, size and notes — every read path already coalesced it to the model name when empty, so the displayed name was half typed and half derived depending on whether an officer had filled a field the form used to insist on.

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

Audit actions: `loan.checked_out` (one per row, `bulk: true`), `loan.checked_in`, `loan.extended`, `loan.written_off`, `loan.cart_scanned`. Gear-side: `gear.added`, `gear.updated`, `gear.deactivated`, `gear.reactivated`, `gear.code_released`, `gear.tags_changed`, `gear_model.*`. **`gear.retired` / `gear.unretired` remain in the enum for historical rows only** — nothing emits them.

**The audit action list exists twice** — `auditAction` in `drizzle/schema.ts` (the column enum) and `AUDIT_ACTIONS` in `features/audit/server/audit-fns.ts` (the filter dropdown). Nothing keeps them in sync; add to both.

## Not built yet

Nothing is marked `counted` until the cave names which models are. Member-facing counted requests (the cart is item-keyed and stays that way), reservations (member-initiated, converting into a loan at the desk), counted backfill, and qualification gating are deliberately deferred.

**No attribute definitions are seeded.** Which attributes exist, at which level, with which options in which order, is the cave's call — a guessed set would be worse than an empty one, because officers would edit around it rather than replace it.
