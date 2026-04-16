/**
 * Shared session tuning knobs. Kept in a tiny module so `session-cookie.ts`
 * (which doesn't import from `session.ts` to avoid a cycle) can derive the
 * cookie `maxAge` from the same source of truth as the D1 row's
 * `expiresAt`.
 */

// Absolute lifetime of a session. Cookie maxAge and row expiresAt both
// derive from this — change it here and both move together.
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// How stale `lastSeenAt` must be before a request touches D1 to slide the
// window. Smaller = more writes; larger = users can drop off the sliding
// window and see their session expire mid-use.
export const SESSION_SLIDING_REFRESH_MS = 1000 * 60 * 60; // 1 hour
