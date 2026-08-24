/**
 * Action implementations for the member gear-cart feature. The shells
 * in `gear-fns.ts` dynamic-import this module so server-only code stays
 * off the client bundle.
 *
 * The cart is a member's pre-checkout intent: they tag pieces they want
 * online, then present a short-lived QR at the gear cave. The officer
 * scans it; the desk pane pre-fills with the cart's items + the member
 * already selected. No reservation, no D1 table — just KV-backed
 * session-scoped state (see `cart-kv.server.ts`).
 *
 * Authorization model:
 *   - Add / remove / clear / get / mint  → approved + current-waiver member
 *     (their own cart only — userId comes from the session).
 *   - Resolve (officer reads scanned QR)  → `gear:loan` permission, same
 *     as the rest of the checkout-desk surface.
 */
import { eq } from "drizzle-orm";

import { CART_TOKEN_PREFIX } from "#/features/gear/lib/cart-token";
import {
  getCart,
  getToken,
  newToken,
  putCart,
  putToken,
  deleteCart,
  CART_TOKEN_TTL_SECONDS,
} from "#/features/gear/server/cart-kv.server";
import type { StoredCart } from "#/features/gear/server/cart-kv.server";
import { requireGearLoanManager } from "#/features/gear/server/permissions.server";
import { getGearByPublicId } from "#/features/gear/server/repo.server";
import {
  getApprovedMemberByPublicId,
  getCartHydrationRowsByPublicIds,
} from "#/features/gear/server/loans-repo.server";
import type { Principal } from "#/server/auth/principal.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { hasCurrentAttestation } from "#/server/waivers/current-attestation.server";
import { getDb, schema } from "#/server/db";

// ── authorization helper ───────────────────────────────────────────────

/**
 * Member-facing gate for cart mutations + reads. Mirrors the route-level
 * `requireCurrentWaiver` guard from `features/auth/guards.ts` — there's
 * no point letting waiver-lapsed members build carts the officer would
 * then have to refuse at the desk. The route guard catches deep links;
 * this guard catches direct server-fn calls.
 */
async function requireCartMember(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (principal.status !== "approved") {
    throw new Error("Forbidden: not an approved member");
  }
  if (!(await hasCurrentAttestation(principal.userId))) {
    throw new Error("Forbidden: current-cycle waiver attestation required");
  }
  return principal;
}

// ── public types ───────────────────────────────────────────────────────

/**
 * Availability of a cart row when read by the member (or seeded into
 * the desk pane via a scanned QR). Mirrors the per-item skip reasons
 * `CheckoutLoansResult` already surfaces so the desk pane can flag a
 * row using the same vocabulary, except `loanable` for the happy path.
 *
 * `no_code` covers the asymmetric case where addToCart rejects null-code
 * pieces up front, but a piece that was added with a code can later
 * have its code cleared by an officer (retire/unretire cycle). Surfacing
 * the row keeps the cart honest with the member instead of vanishing
 * the entry silently.
 */
export type CartItemAvailability =
  | "loanable"
  | "on_loan"
  | "not_serviceable"
  | "retired"
  | "no_code";

/**
 * Hydrated cart row. Shaped to drop into the desk pane's existing
 * `GearLookupRow` consumers (description, code, type, lifecycle,
 * condition, hasOpenLoan) plus an explicit `availability` and the
 * `addedAt` timestamp for stable client-side ordering.
 */
export interface CartItemRow {
  publicId: string;
  /** Nullable because a piece's code can be cleared after it landed
   *  in the cart; the row then surfaces with `availability: "no_code"`
   *  so the member sees a deliberate flag instead of a silent drop. */
  code: string | null;
  description: string;
  typeName: string;
  thumbnailKey: string | null;
  lifecycle: schema.GearLifecycle;
  condition: schema.GearCondition;
  hasOpenLoan: boolean;
  availability: CartItemAvailability;
  /** ms-since-epoch */
  addedAt: number;
}

export interface MyCartResult {
  items: CartItemRow[];
}

export type AddToCartResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "retired" | "no_code" | "already_in_cart";
    };

export type MintCartTokenResult =
  | {
      ok: true;
      /** Full `ucmc-cart:<uuid>` payload, ready for the QR encoder. */
      token: string;
      /** ms-since-epoch when the token's KV entry will expire. */
      expiresAt: number;
    }
  | { ok: false; reason: "empty_cart" };

export interface ResolvedCart {
  memberPublicId: string;
  memberFullName: string;
  primaryEmail: string;
  items: CartItemRow[];
}

export type ResolveCartTokenResult =
  | { ok: true; cart: ResolvedCart }
  | { ok: false; reason: "expired" | "member_unavailable" };

// ── hydration ──────────────────────────────────────────────────────────

/**
 * Resolve every cart entry to a hydrated row in one D1 round-trip.
 * Missing publicIds (gear hard-deleted) drop out — the caller persists
 * the trimmed entries so subsequent reads stay O(remaining).
 *
 * Availability priority mirrors `checkoutLoansAction`'s skip order:
 * retired → not_serviceable → on_loan → no_code → loanable.
 */
async function hydrateCartItems(
  cart: StoredCart,
): Promise<{ items: CartItemRow[]; prunedCart: StoredCart }> {
  if (cart.items.length === 0) {
    return { items: [], prunedCart: cart };
  }
  const publicIds = cart.items.map((i) => i.gearPublicId);
  const rows = await getCartHydrationRowsByPublicIds(publicIds);
  const byPublicId = new Map(rows.map((r) => [r.publicId, r]));

  const items: CartItemRow[] = [];
  const survivingEntries: StoredCart["items"] = [];
  for (const entry of cart.items) {
    const row = byPublicId.get(entry.gearPublicId);
    if (!row) {
      // Hard-deleted gear is pruned from the cart silently — nothing
      // for the member to act on and no point keeping the publicId.
      continue;
    }
    survivingEntries.push(entry);

    let availability: CartItemAvailability;
    if (row.lifecycle === "retired") {
      availability = "retired";
    } else if (row.condition !== "serviceable") {
      availability = "not_serviceable";
    } else if (row.hasOpenLoan) {
      availability = "on_loan";
    } else if (row.code === null) {
      availability = "no_code";
    } else {
      availability = "loanable";
    }

    items.push({
      publicId: row.publicId,
      code: row.code,
      description: row.description,
      typeName: row.typeName,
      thumbnailKey: row.thumbnailKey,
      lifecycle: row.lifecycle,
      condition: row.condition,
      hasOpenLoan: row.hasOpenLoan,
      availability,
      addedAt: entry.addedAt,
    });
  }
  items.sort((a, b) => a.addedAt - b.addedAt);
  const prunedCart: StoredCart = {
    items: survivingEntries,
    updatedAt: cart.updatedAt,
  };
  return { items, prunedCart };
}

// ── reads ──────────────────────────────────────────────────────────────

export async function getMyCartAction(): Promise<MyCartResult> {
  const principal = await requireCartMember();
  const stored = await getCart(principal.userId);
  const { items, prunedCart } = await hydrateCartItems(stored);
  // Best-effort prune: only rewrite KV when hydration actually dropped
  // entries (hard-deleted gear). The no-op branch is important — it
  // avoids refreshing the 24 h TTL on every read, which would let an
  // open tab keep a cart alive indefinitely.
  if (prunedCart.items.length !== stored.items.length) {
    await putCart(principal.userId, {
      items: prunedCart.items,
      updatedAt: Date.now(),
    });
  }
  return { items };
}

// ── writes ─────────────────────────────────────────────────────────────

/**
 * Read-modify-write into KV. KV has no CAS, so two concurrent add
 * calls from the same user could clobber each other. The UI defends
 * against this by disabling the button while `add.isPending`; the
 * server treats double-click as best-effort.
 */
export async function addToCartAction(input: {
  gearPublicId: string;
}): Promise<AddToCartResult> {
  const principal = await requireCartMember();
  const gear = await getGearByPublicId(input.gearPublicId);
  if (!gear) {
    return { ok: false, reason: "not_found" };
  }
  if (gear.lifecycle === "retired") {
    return { ok: false, reason: "retired" };
  }
  if (gear.code === null) {
    // No scannable code means the desk pane couldn't ingest this row
    // even if cart-scanned. Force the officer to tag the piece first.
    return { ok: false, reason: "no_code" };
  }
  const cart = await getCart(principal.userId);
  if (cart.items.some((i) => i.gearPublicId === input.gearPublicId)) {
    return { ok: false, reason: "already_in_cart" };
  }
  const now = Date.now();
  await putCart(principal.userId, {
    items: [...cart.items, { gearPublicId: input.gearPublicId, addedAt: now }],
    updatedAt: now,
  });
  return { ok: true };
}

export async function removeFromCartAction(input: {
  gearPublicId: string;
}): Promise<{ ok: true }> {
  const principal = await requireCartMember();
  const cart = await getCart(principal.userId);
  const remaining = cart.items.filter(
    (i) => i.gearPublicId !== input.gearPublicId,
  );
  if (remaining.length === cart.items.length) {
    return { ok: true };
  }
  if (remaining.length === 0) {
    await deleteCart(principal.userId);
  } else {
    await putCart(principal.userId, {
      items: remaining,
      updatedAt: Date.now(),
    });
  }
  return { ok: true };
}

export async function clearCartAction(): Promise<{ ok: true }> {
  const principal = await requireCartMember();
  await deleteCart(principal.userId);
  return { ok: true };
}

// ── QR token mint / resolve ────────────────────────────────────────────

export async function mintCartTokenAction(): Promise<MintCartTokenResult> {
  const principal = await requireCartMember();
  const cart = await getCart(principal.userId);
  if (cart.items.length === 0) {
    // Minting on an empty cart used to silently succeed and surface
    // "your cart is empty" at the officer's desk after a scan. Surface
    // the failure up front so the dialog can prompt the member to
    // add gear first.
    return { ok: false, reason: "empty_cart" };
  }
  const token = newToken();
  const createdAt = Date.now();
  await putToken(token, {
    userId: principal.userId,
    snapshot: cart.items.map((i) => i.gearPublicId),
    createdAt,
  });
  // Minting is a strong "I'm about to use this cart" signal — bump
  // the cart's 24 h TTL so the contents don't expire between mint
  // and the walk to the cave.
  await putCart(principal.userId, cart);
  return {
    ok: true,
    token: `${CART_TOKEN_PREFIX}${token}`,
    expiresAt: createdAt + CART_TOKEN_TTL_SECONDS * 1000,
  };
}

export async function resolveCartTokenAction(input: {
  token: string;
}): Promise<ResolveCartTokenResult> {
  const officer = await requireGearLoanManager();
  const raw = input.token.startsWith(CART_TOKEN_PREFIX)
    ? input.token.slice(CART_TOKEN_PREFIX.length)
    : input.token;
  const stored = await getToken(raw);
  if (!stored) {
    return { ok: false, reason: "expired" };
  }

  // Resolve the member's display info from the snapshot's userId.
  // The member combobox keys on `publicId`, so we look it up via the
  // users table to surface the same shape the picker expects.
  const memberRows = await getDb()
    .select({ publicId: schema.users.publicId })
    .from(schema.users)
    .where(eq(schema.users.id, stored.userId))
    .limit(1);
  const memberPublicId = memberRows.at(0)?.publicId;
  if (!memberPublicId) {
    return { ok: false, reason: "member_unavailable" };
  }
  const member = await getApprovedMemberByPublicId(memberPublicId);
  if (!member) {
    return { ok: false, reason: "member_unavailable" };
  }

  // Hydrate the snapshot — not the live cart. The QR represents intent
  // at mint time, so a cart edit after minting doesn't drift the
  // officer's view.
  const synthetic: StoredCart = {
    items: stored.snapshot.map((gearPublicId) => ({
      gearPublicId,
      addedAt: stored.createdAt,
    })),
    updatedAt: stored.createdAt,
  };
  const { items } = await hydrateCartItems(synthetic);

  await recordAuditEvent({
    actorUserId: officer.userId,
    action: "loan.cart_scanned",
    targetType: "user",
    targetId: stored.userId,
    metadata: {
      memberUserId: stored.userId,
      itemCount: items.length,
    },
  });

  return {
    ok: true,
    cart: {
      memberPublicId: member.publicId,
      memberFullName: member.fullName,
      primaryEmail: member.primaryEmail,
      items,
    },
  };
}
