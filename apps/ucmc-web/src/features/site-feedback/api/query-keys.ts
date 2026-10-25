/**
 * TanStack Query keys for the site-feedback feature. Centralized so mutation
 * hooks and query options reference the same source of truth — mismatches
 * between the key a query reads and the key a mutation invalidates would
 * silently leave stale UI on screen.
 */
export const siteFeedbackKeys = {
  all: ["site-feedback"],
  mine: ["site-feedback", "mine"],
  list: ["site-feedback", "list"],
  overview: ["site-feedback", "overview"],
  /** Prefix over every triage view and search, for invalidation. */
  triageAll: ["site-feedback", "triage"],
  triage: (view: string, q: string | undefined) =>
    ["site-feedback", "triage", view, q ?? ""] as const,
  issue: (id: string) => ["site-feedback", "issue", id] as const,
  related: (id: string) => ["site-feedback", "related", id] as const,
} as const;
