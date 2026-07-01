/**
 * TanStack Query keys for the Trip Gallery feature. The /gallery page
 * reads the bundled photo list from a single cache entry; every
 * mutation invalidates it.
 */
export const GALLERY_LIST_QUERY_KEY = ["gallery", "list"] as const;
