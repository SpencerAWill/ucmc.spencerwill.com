/**
 * Forward-compatibility shim for the permission renames in migration
 * `0064` (`feedback:submit`/`:manage` → `site_feedback:*`, `landing:edit`
 * → `landing:manage`).
 *
 * The renames are an `UPDATE permissions SET name`, so a database that
 * has not yet run `0064` still hands back the old names while this
 * build's gates ask for the new ones. That happens in two places:
 *
 *  1. **Local dev / a fresh checkout** — pulling this branch without
 *     running `db:migrate:local` would otherwise revoke site feedback
 *     and landing editing from everyone who holds them.
 *  2. **A deploy whose migration step did not run** (a re-run that
 *     skipped it, a manual `wrangler deploy`).
 *
 * Folding the aliases in where the principal is assembled means every
 * gate — server actions and the client's `hasPermission` alike, since
 * both read the principal's `permissions` list — keeps working without a
 * per-call-site `includes(new) || includes(old)`.
 *
 * This does NOT cover the opposite skew, a *previous* build running
 * against an already-migrated database (the window between
 * `d1 migrations apply` and `wrangler deploy`). Code shipped in this
 * release cannot reach code shipped in the last one; closing that window
 * needs the shim to land one release ahead of the rename, which is the
 * sequence to follow for the next one.
 *
 * **Remove this module once `0064` has been applied to every
 * environment** (dev + prod), along with its two call sites in
 * `principal.server.ts`.
 */

/** Current name → the pre-`0064` name it was renamed from. */
const LEGACY_ALIASES: Record<string, string> = {
  "site_feedback:submit": "feedback:submit",
  "site_feedback:manage": "feedback:manage",
  "landing:manage": "landing:edit",
};

/**
 * Return `names` with each renamed permission's current name added when
 * the list carries only its legacy name. Never removes anything, and
 * never invents a grant: a name is added only when the holder already
 * has the same permission under its old name.
 */
export function withLegacyPermissionAliases(
  names: readonly string[],
): string[] {
  const held = new Set(names);
  for (const [current, legacy] of Object.entries(LEGACY_ALIASES)) {
    if (held.has(legacy)) {
      held.add(current);
    }
  }
  return [...held];
}
