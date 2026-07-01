import {
  ANNOUNCEMENTS_LIST_QUERY_KEY,
  ANNOUNCEMENTS_UNREAD_QUERY_KEY,
} from "#/features/announcements/api/query-keys";
import {
  listAnnouncementsFn,
  unreadAnnouncementsCountFn,
} from "#/features/announcements/server/announcements-fns";

/**
 * Full announcements list, ordered newest-first (server controls the
 * order). 30s staleTime keeps the list responsive without hammering the
 * server on every navigation back to /announcements.
 */
export function announcementsListQueryOptions() {
  return {
    queryKey: ANNOUNCEMENTS_LIST_QUERY_KEY,
    queryFn: () => listAnnouncementsFn(),
    staleTime: 30_000,
  } as const;
}

/**
 * Unread-count badge for the header bell. 60s staleTime since the
 * exact number is decorative — the bell is a hint, not a notification
 * delivery channel. Pass `{ enabled }` to gate on auth / permissions
 * (the bell hides itself for anonymous + non-`announcements:read`
 * callers, so the query shouldn't fire either).
 */
export function announcementsUnreadQueryOptions(options: { enabled: boolean }) {
  return {
    queryKey: ANNOUNCEMENTS_UNREAD_QUERY_KEY,
    queryFn: () => unreadAnnouncementsCountFn(),
    staleTime: 60_000,
    enabled: options.enabled,
  } as const;
}
