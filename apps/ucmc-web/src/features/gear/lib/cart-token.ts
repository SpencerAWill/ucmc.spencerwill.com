/**
 * Prefix that marks a member's gear-cart QR payload at the gear desk.
 * The cart-QR encodes `${CART_TOKEN_PREFIX}${uuid}`.
 *
 * Lives in `lib/` rather than `server/` because both the client (QR
 * encoder) and the server (token parser) need the same constant.
 *
 * **The desk does not test this prefix directly** — `parseScanPayload`
 * in `lib/scan-payload.ts` is the one discriminator, and it owns the
 * decision for every payload shape. An `isCartToken()` helper used to
 * live here and was called inline by each pane; it went when the panes
 * moved to `parseScanPayload`, because a second, weaker discriminator
 * sitting beside the real one is precisely the drift #224 finding 5
 * asked us to stop.
 */
export const CART_TOKEN_PREFIX = "ucmc-cart:";
