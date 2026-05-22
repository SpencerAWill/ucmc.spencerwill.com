/**
 * TanStack Query keys for the Goosedown Gazette feature.
 *
 * `GAZETTE_LIST_QUERY_KEY` is the bundled list of all issues — the
 * /gazette list page reads from it; every mutation invalidates it.
 * `gazetteIssueQueryKey(publicId)` is the per-issue detail key used
 * by the /gazette/$publicId route's loader; deletes also invalidate
 * the list key.
 */
export const GAZETTE_LIST_QUERY_KEY = ["gazette", "list"] as const;

export function gazetteIssueQueryKey(publicId: string) {
  return ["gazette", "issue", publicId] as const;
}
