---
paths:
  - "apps/ucmc-web/src/features/gear/**/*cart*"
  - "apps/ucmc-web/src/routes/my.gear.cart.tsx"
---

# Member gear cart

Part of the gear rule; `gear/desk.md` covers how the desk resolves a cart QR.

## Member cart (`/my/gear/cart`)

Each approved + current-waiver member has a personal pre-checkout cart so they can tag items online and present a QR at the cave instead of dictating codes at the desk.

**Storage is KV-only — no D1 table, no per-item reservation.** `gear-cart:user:<userId>` holds the live cart with a 24 h TTL (refreshed on every mutation); a separate `gear-cart-token:<uuid>` holds a snapshot at QR-generation time with a 5 min TTL. The QR encodes `ucmc-cart:<uuid>` — the desk scanner branches on the prefix to call `resolveCartTokenFn` instead of `getItemByCode`, and **the _snapshot_ (not the live cart) is what resolves**, so a post-mint edit doesn't drift the officer's view.

Member writes go through `requireCartMember` (approved + current-cycle waiver attestation); `resolveCartTokenAction` is officer-only (`gear:loan`) and emits `loan.cart_scanned`.

Hydration computes per-row `availability` (`loanable` / `on_loan` / `not_serviceable` / `retired` / `not_found`) so the cart page can flag unavailable items inline AND the desk pane can block submit until they're removed. **The status check is `!== "active"`, not `=== "retired"`** — a `lost` or `disposed` item is equally un-loanable.

**Cart membership is not audited** — it's a private, ephemeral surface; only the officer scan creates an audit row.

QR rendering uses the **`qrcode`** dep on a canvas inside `<CartQrDialog />`; `jsbarcode` owns linear-barcode label printing.

The "Add to cart" button is hidden for anonymous / non-approved viewers **and for officers operating gear admin tools (`gear:manage`)**. **Items without a `code` cannot be added** — the desk would have no scannable identifier even after a cart scan.
