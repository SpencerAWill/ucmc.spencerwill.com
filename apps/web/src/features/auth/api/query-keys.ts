/**
 * TanStack Query keys for the auth feature. Centralized here so mutation
 * hooks and query options reference the same source of truth — a key
 * mismatch between a query and the mutation that invalidates it would
 * silently leave stale UI on screen.
 */
export const SESSION_QUERY_KEY = ["auth", "session"] as const;

export const PROFILE_QUERY_KEY = ["account", "profile"] as const;

export const PASSKEY_LIST_QUERY_KEY = ["account", "passkeys"] as const;
