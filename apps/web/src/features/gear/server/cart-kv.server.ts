/**
 * KV-backed store for member gear carts plus their short-lived
 * checkout-desk scan tokens. Mirrors the WebAuthn challenge helpers in
 * `features/auth/server/webauthn-challenge.server.ts` — namespaced
 * keys, JSON store/parse, TTL on every write.
 *
 * Two surfaces:
 *   - `gear-cart:user:<userId>` — the member's live cart, 24 h TTL,
 *     refreshed on every mutation. Contents are the source of truth
 *     for `/my/gear/cart`.
 *   - `gear-cart-token:<token>` — a transient snapshot of the cart at
 *     QR-generation time, 5 min TTL. The QR payload is
 *     `${CART_TOKEN_PREFIX}<token>`. Officers read the snapshot via
 *     `resolveCartToken`; minting a new token does NOT invalidate
 *     prior tokens (KV doesn't support a cheap secondary-key lookup
 *     and the short window makes overlap a non-issue).
 *
 * No singleton — `getKv()` returns the binding directly. The function
 * wrappers exist so `env.KV` is never touched at module scope.
 */
import { getKv } from "#/server/kv";

/** 24 h — long enough to build a cart in advance of a cave visit; short
 *  enough that an abandoned cart self-cleans without our help. */
export const CART_TTL_SECONDS = 60 * 60 * 24;

/** 5 min — matches the WebAuthn ceremony TTL. Long enough that an
 *  officer fumbling the scanner can re-scan; short enough that a
 *  photographed QR isn't a long-lived bearer credential. */
export const CART_TOKEN_TTL_SECONDS = 300;

export interface CartItemEntry {
  gearPublicId: string;
  /** ms-since-epoch — JSON-safe, used by the UI for stable add-order. */
  addedAt: number;
}

export interface StoredCart {
  items: CartItemEntry[];
  updatedAt: number;
}

export interface StoredCartToken {
  userId: string;
  /** Snapshot of cart `gearPublicId[]` at mint time. Resolves to the
   *  intent the member presented, even if they edited the cart after. */
  snapshot: string[];
  createdAt: number;
}

function cartKey(userId: string): string {
  return `gear-cart:user:${userId}`;
}

function tokenKey(token: string): string {
  return `gear-cart-token:${token}`;
}

export async function getCart(userId: string): Promise<StoredCart> {
  const raw = await getKv().get(cartKey(userId));
  if (!raw) return { items: [], updatedAt: 0 };
  try {
    return JSON.parse(raw) as StoredCart;
  } catch {
    return { items: [], updatedAt: 0 };
  }
}

export async function putCart(userId: string, cart: StoredCart): Promise<void> {
  await getKv().put(cartKey(userId), JSON.stringify(cart), {
    expirationTtl: CART_TTL_SECONDS,
  });
}

export async function deleteCart(userId: string): Promise<void> {
  await getKv().delete(cartKey(userId));
}

export function newToken(): string {
  return crypto.randomUUID();
}

export async function putToken(
  token: string,
  value: StoredCartToken,
): Promise<void> {
  await getKv().put(tokenKey(token), JSON.stringify(value), {
    expirationTtl: CART_TOKEN_TTL_SECONDS,
  });
}

export async function getToken(token: string): Promise<StoredCartToken | null> {
  const raw = await getKv().get(tokenKey(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredCartToken;
  } catch {
    return null;
  }
}
