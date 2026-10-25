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
} as const;
