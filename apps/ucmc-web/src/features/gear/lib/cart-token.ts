/**
 * Prefix that marks a member's gear-cart QR payload at the gear desk.
 * The cart-QR encodes `${CART_TOKEN_PREFIX}${uuid}`; the desk pane's
 * scanner branches on this prefix to distinguish a cart-resolve call
 * from a raw gear-code scan. Bare gear codes (`CH93`, `LJ4`, …) never
 * collide with the `ucmc-cart:` namespace.
 *
 * Lives in `lib/` rather than `server/` because both the client (QR
 * encoder, scanner discriminator) and the server (token parser) need
 * the same constant.
 */
export const CART_TOKEN_PREFIX = "ucmc-cart:";

export function isCartToken(value: string): boolean {
  return value.startsWith(CART_TOKEN_PREFIX);
}
