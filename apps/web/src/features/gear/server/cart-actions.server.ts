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
import { and, eq, isNull } from "drizzle-orm";

import { WAIVER_VERSION } from "#/config/legal";
import { currentWaiverCycle } from "#/config/waiver-cycle";
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
  getOpenLoanForGear,
} from "#/features/gear/server/loans-repo.server";
import type { Principal } from "#/server/auth/principal.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
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
  const cycle = currentWaiverCycle();
  const rows = await getDb()
    .select({ id: schema.waiverAttestations.id })
    .from(schema.waiverAttestations)
    .where(
      and(
        eq(schema.waiverAttestations.userId, principal.userId),
        eq(schema.waiverAttestations.cycle, cycle),
        eq(schema.waiverAttestations.version, WAIVER_VERSION),
        isNull(schema.waiverAttestations.revokedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
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
 */
export type CartItemAvailability =
  | "loanable"
  | "on_loan"
  | "not_serviceable"
  | "retired"
  | "not_found";

/**
 * Hydrated cart row. Shaped to drop into the desk pane's existing
 * `GearLookupRow` consumers (description, code, type, lifecycle,
 * condition, hasOpenLoan) plus an explicit `availability` and the
 * `addedAt` timestamp for stable client-side ordering.
 */
export interface CartItemRow {
  publicId: string;
  code: string;
  description: string;
  typeName: string;
  thumbnailKey: string | null;
  lifecycle: schema.GearLifecycle;
  condition: schema.GearCondition;
  hasOpenLoan: boolean;
  openLoanMemberFullName: string | null;
  availability: CartItemAvailability;
  /** ms-since-epoch */
  addedAt: number;
}

export interface MyCartResult {
  items: CartItemRow[];
  /** ms-since-epoch of the last mutation, or 0 for a never-seeded cart. */
  updatedAt: number;
}

export type AddToCartResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "retired" | "no_code" | "already_in_cart";
    };

export interface MintCartTokenResult {
  ok: boolean;
  /** Full `ucmc-cart:<uuid>` payload, ready for the QR encoder. */
  token: string;
  /** ms-since-epoch when the token's KV entry will expire. */
  expiresAt: number;
}

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

async function hydrateCartItems(
  cart: StoredCart,
): Promise<{ items: CartItemRow[]; prunedCart: StoredCart }> {
  const items: CartItemRow[] = [];
  const survivingEntries: StoredCart["items"] = [];
  for (const entry of cart.items) {
    const gear = await getGearByPublicId(entry.gearPublicId);
    if (!gear) {
      // Hard-deleted gear gets pruned from the cart — there's nothing
      // for the member to act on, and we don't want a stale publicId
      // hanging around forever.
      continue;
    }
    survivingEntries.push(entry);

    // `gear.code` is nullable in the schema, but addToCartAction
    // rejects null-code pieces; an existing cart entry might still
    // carry one if an officer cleared the code after the member added
    // the piece (it then became unscannable). Treat as not_found-like.
    if (gear.code === null) {
      continue;
    }

    const openLoan = await getOpenLoanForGear(gear.id);
    const hasOpenLoan = openLoan !== null;
    let availability: CartItemAvailability;
    if (gear.lifecycle === "retired") {
      availability = "retired";
    } else if (gear.condition !== "serviceable") {
      availability = "not_serviceable";
    } else if (hasOpenLoan) {
      availability = "on_loan";
    } else {
      availability = "loanable";
    }

    items.push({
      publicId: gear.publicId,
      code: gear.code,
      description: gear.description,
      typeName: gear.typeName,
      thumbnailKey: gear.thumbnailKey,
      lifecycle: gear.lifecycle,
      condition: gear.condition,
      hasOpenLoan,
      openLoanMemberFullName: null,
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
  // Best-effort prune: if hydration dropped not_found entries, persist
  // the trimmed cart so subsequent reads are O(remaining). Fire-and-
  // forget — a KV write failure here doesn't affect the response.
  if (prunedCart.items.length !== stored.items.length) {
    await putCart(principal.userId, {
      items: prunedCart.items,
      updatedAt: Date.now(),
    });
  }
  return { items, updatedAt: stored.updatedAt };
}

// ── writes ─────────────────────────────────────────────────────────────

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
  // Empty carts still mint a token — the desk pane will surface
  // "cart is empty" once resolved, which is more helpful than a
  // generic failure here.
  const token = newToken();
  const createdAt = Date.now();
  await putToken(token, {
    userId: principal.userId,
    snapshot: cart.items.map((i) => i.gearPublicId),
    createdAt,
  });
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
