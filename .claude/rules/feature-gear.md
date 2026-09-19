---
paths:
  - "apps/ucmc-web/src/features/gear/**"
  - "apps/ucmc-web/src/routes/gear.*"
  - "apps/ucmc-web/src/routes/my.gear*"
---

# Gear inventory, loans, and carts

## Inventory (`/gear`, `/gear/$publicId`)

Every piece is a row in `gear`, exclusively partitioned by a `gear_types` row and tagged via the `gear_tag_assignments` join. Each piece is referenced on its laminated tag by a **freeform `code`** string (e.g. `CH93`) — nullable + unique. **Retiring NULLs the column so the same string can be reissued**; the `gear.retired` audit event captures `priorCode`.

**Lifecycle (`active`/`retired`) and condition (`serviceable`/`needs_repair`/`missing`/`lost`) are intentionally orthogonal** so a loan table could land without reshaping `gear`.

Tags have a `visibility` column (`public`/`internal`) — **internal tags are stripped from list/detail responses for non-officers at the repo layer, not just the UI.**

Permissions: browse is `gear:read` (auto-granted to `role_member`); create/edit/retire/import and type/tag management need `gear:manage`. Recording an inspection needs only **`gear:inspect`**, checked as `gear:inspect || gear:manage` in `requireGearInspector` so a trip leader can log a failed rope without the authority to retire pieces or bulk-import inventory; seeded with no grants, to be delegated at `/access`.

Type and tag management are dialogs on `/gear`, not standalone routes. Bulk CSV import reuses the same papaparse helper pattern as members' pre-add sheet.

The **inspection log** is append-only per piece (`gear_inspections`; pass/fail/advisory), surfaced on the detail page. **The inspector's display name is snapshotted at write time** to survive an officer-deletion FK SET NULL.

Officers can **print barcode labels** for one or many pieces (CODE128 SVG via `jsbarcode`) — a Dialog whose `@media print` rules hide everything else on the page.

## Loans (`/gear/loans`, `/gear/loans/$publicId`, `/my/gear`)

Each loan is a row in `gear_loans` linking one `gear` to one borrower with its own `dueAt`. One officer-driven checkout flow generates N loan rows; check-in batches may span multiple borrowers (each row resolves its own loan from the gear code).

**The partial unique index `gear_loans_one_active_per_gear` on `(gear_id) WHERE returned_at IS NULL` is the race protector — the per-row pre-check in the action is UX only.** Retiring on-loan gear is blocked (typed `on_loan` result on `retireGearAction`; the FK is also `RESTRICT` as defense-in-depth).

Officer-only flows gate on `gear:loan` (separate from `gear:manage` so a "gear cave keeper" role can be delegated independently); `/my/gear` is member-self-read, gated on `gear:read` plus an in-action filter on the borrower's userId.

The **gear-desk Sheet** (`components/gear-desk-sheet.tsx`) hosts both checkout and check-in behind a tab toggle, reachable from a single responsive header button on `/gear/loans`. An earlier mobile FAB iteration was dropped because the FAB's fixed positioning fought with the sidebar's stacking context.

Audit actions: `loan.checked_out` (one event per row in a batch, with `bulk: true`), `loan.checked_in`, `loan.extended`, `loan.cart_scanned`.

### Barcode scanning is hand-rolled

Native `BarcodeDetector` on Chrome / Edge / Android Chrome / Safari iOS 17+ / Safari macOS 17+ (zero deps, zero WASM), with a `barcode-detector/ponyfill` fallback for Firefox / pre-17 Safari. **The ZXing WASM the ponyfill needs is vendored locally** at `public/zxing-wasm/zxing_reader.wasm` and served same-origin via `prepareZXingModule({ overrides.locateFile })` so `connect-src 'self'` stays sufficient. Format whitelist is `["code_128", "qr_code"]`. CSP needs `script-src 'wasm-unsafe-eval'`; `Permissions-Policy: camera=(self)` is scoped to `/gear/loans*` only (`server/headers.server.ts` `securityHeadersForPath`).

### Backfill

`LoansBulkImportSheet` (header "Backfill" button on `/gear/loans`, gated by `gear:loan`). `bulkImportLoansAction` reads CSV (file / clipboard / manual rows), resolves members by primary email through `user_emails` and gear by `code`, and supports both open and pre-returned rows in the same import.

**Eligibility checks for `lifecycle` and `condition` are intentionally relaxed** — a piece retired today may have been serviceable when loaned years ago. The partial unique index still gates open backfill rows, surfaced as an `already_on_loan` skip. Audit events carry `bulk: true, backfill: true`; closed-loan rows also emit a `loan.checked_in` in the same call. **Backfill does NOT mutate `gear.condition` from `condition_at_return`** — the historical condition belongs on the loan row only.

## Member cart (`/my/gear/cart`)

Each approved + current-waiver member has a personal pre-checkout cart so they can tag pieces online and present a QR at the cave instead of dictating codes at the desk.

**Storage is KV-only — no D1 table, no per-piece reservation.** `gear-cart:user:<userId>` holds the live cart with a 24 h TTL (refreshed on every mutation); a separate `gear-cart-token:<uuid>` holds a snapshot at QR-generation time with a 5 min TTL. The QR encodes `ucmc-cart:<uuid>` — the gear-desk scanner branches on the `ucmc-cart:` prefix to call `resolveCartTokenFn` instead of `getGearByCode`, and **the _snapshot_ (not the live cart) is what resolves, so a post-mint edit doesn't drift the officer's view.**

Member writes go through `requireCartMember` (approved + current-cycle waiver attestation); `resolveCartTokenAction` is officer-only (`gear:loan`) and emits `loan.cart_scanned`.

Hydration computes per-row `availability` (`loanable` / `on_loan` / `not_serviceable` / `retired` / `not_found`) so the cart page can flag unavailable items inline AND the desk pane can pre-emptively block submit until they're removed — the post-submit `CheckoutLoansResult` skip path remains as a second line of defense.

**Cart membership is not audited** — it's a private, ephemeral surface; only the officer scan creates an audit row, and checkout itself still emits `loan.checked_out`.

QR rendering uses the **`qrcode`** dep on a canvas inside `<CartQrDialog />`; `jsbarcode` continues to own the linear-barcode label-printing path.

The "Add to cart" button on `/gear` list cards and the detail page is hidden for anonymous / non-approved viewers **and for officers operating gear admin tools (`gear:manage`)** so it doesn't clutter inventory management. **Pieces without a `code` cannot be added** — the desk would have no scannable identifier even after a cart scan.
