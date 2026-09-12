/**
 * TanStack Query keys for the sponsors feature. /sponsors reads its
 * sponsor list as a single bundle, so one cache entry covers the grid
 * and every mutation invalidates the same key. The two markdown bands
 * are separate entries under `["markdown-page", slug]`, owned by the
 * shared markdown-pages module.
 */
export const SPONSORS_CONTENT_QUERY_KEY = ["sponsors", "content"] as const;
