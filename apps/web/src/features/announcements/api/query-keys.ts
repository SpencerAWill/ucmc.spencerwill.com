/**
 * TanStack Query keys for the announcements feature. Centralized here so
 * mutation hooks and query options reference the same source of truth —
 * mismatches between the key a query reads and the key a mutation
 * invalidates would silently leave stale UI on screen.
 */
export const ANNOUNCEMENTS_LIST_QUERY_KEY = ["announcements", "list"] as const;

export const ANNOUNCEMENTS_UNREAD_QUERY_KEY = [
  "announcements",
  "unreadCount",
] as const;
