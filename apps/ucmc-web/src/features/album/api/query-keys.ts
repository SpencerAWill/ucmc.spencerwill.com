/**
 * TanStack Query keys for the Album feature. The /album page
 * reads the bundled photo list from a single cache entry; every
 * mutation invalidates it.
 */
export const ALBUM_LIST_QUERY_KEY = ["album", "list"] as const;
