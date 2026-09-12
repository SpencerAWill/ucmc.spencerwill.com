/**
 * Slug enum + permission map for `markdown_pages`. Client-safe (no
 * server-only imports) so route guards and the sidebar can both
 * import it. The matching SQLite enum lives in `drizzle/schema.ts`
 * — they must agree.
 *
 * Adding a new editable public page is a four-line change:
 *   1. Add the slug here AND to `markdownPageSlug` in `drizzle/schema.ts`.
 *   2. Add a permission pair to `MARKDOWN_PAGE_PERMISSIONS`.
 *   3. Add the permissions + grants in a new seed migration.
 *   4. Add the seed row to `markdown_pages` in the same (or a sibling)
 *      seed migration.
 *
 * `history.narrative` reuses the legacy `history:view` / `history:manage`
 * permissions so the existing /history route guard, sidebar gate, and
 * audit chain don't churn. The other four pages adopt the new
 * `public_<slug>:view` / `public_<slug>:manage` convention.
 */
export const MARKDOWN_PAGE_SLUGS = [
  "history.narrative",
  "policies",
  "scholarships",
  "gear_cave",
  "resources",
  "volunteer",
  // /sponsors carries two independently-edited markdown bands under one
  // permission: `sponsors` introduces the grid to a member or visitor,
  // `sponsors_pitch` makes the case to a prospective sponsor. They're
  // separate slugs rather than one long page because they're written for
  // different readers and an officer edits one without touching the
  // other — the same reason /history's narrative is its own slug.
  "sponsors",
  "sponsors_pitch",
] as const;
export type MarkdownPageSlug = (typeof MARKDOWN_PAGE_SLUGS)[number];

export interface MarkdownPagePermissions {
  /** Required to GET the page content (route guard + sidebar gate). */
  view: string;
  /** Required to update the markdown (action gate + edit affordance). */
  manage: string;
}

export const MARKDOWN_PAGE_PERMISSIONS: Record<
  MarkdownPageSlug,
  MarkdownPagePermissions
> = {
  "history.narrative": { view: "history:view", manage: "history:manage" },
  policies: {
    view: "public_policies:view",
    manage: "public_policies:manage",
  },
  scholarships: {
    view: "public_scholarships:view",
    manage: "public_scholarships:manage",
  },
  gear_cave: {
    view: "public_gear_cave:view",
    manage: "public_gear_cave:manage",
  },
  resources: {
    view: "public_resources:view",
    manage: "public_resources:manage",
  },
  volunteer: {
    view: "public_volunteer:view",
    manage: "public_volunteer:manage",
  },
  sponsors: {
    view: "public_sponsors:view",
    manage: "public_sponsors:manage",
  },
  sponsors_pitch: {
    view: "public_sponsors:view",
    manage: "public_sponsors:manage",
  },
};

export function permissionsForSlug(
  slug: MarkdownPageSlug,
): MarkdownPagePermissions {
  return MARKDOWN_PAGE_PERMISSIONS[slug];
}
