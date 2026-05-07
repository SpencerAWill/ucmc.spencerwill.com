/**
 * Lightweight server-side auth errors. Kept in its own module (with
 * no DB/KV imports) so route handlers and other consumers can pull
 * the sentinel without dragging in `principal.server.ts`'s heavier
 * Drizzle + KV dependencies at module scope.
 */

/**
 * Thrown by server actions and route handlers when the caller is not
 * signed in. Routes should `instanceof`-check this and translate to a
 * 401 — string-matching the message couples the route's correctness
 * to specific error wording.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "UnauthorizedError";
  }
}
