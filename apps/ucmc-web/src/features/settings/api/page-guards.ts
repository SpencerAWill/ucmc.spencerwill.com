/**
 * Route guards for flag-gated pages.
 *
 * Almost every reachable page carries a `pages.*` kill switch. These
 * guards read the public-flags snapshot and throw `notFound()` when a
 * page is switched off, so a disabled page 404s on direct navigation to
 * match its disappearance from the nav. A handful of pages (Settings,
 * Audit, auth/registration plumbing, legal/compliance pages) intentionally
 * have no flag and stay always-on.
 *
 * Lives in the settings feature (not auth's `guards.ts`) because the
 * check needs the settings feature's `publicFlagsQueryOptions`, and
 * `features/auth` must not import another feature. Routes freely compose
 * features, so route `beforeLoad` hooks import this directly.
 */
import type { QueryClient } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";

import { requireViewPermission } from "#/features/auth/guards";
import type { Principal } from "#/server/auth/principal.server";
import type { PageFlagKey } from "#/server/settings/settings-registry";
import type { PublicFlags } from "#/features/settings/server/settings-fns";
import { publicFlagsQueryOptions } from "./queries";

/** The boolean, non-page fields of the public flags snapshot. */
type FeatureFlagField = {
  [K in keyof PublicFlags]: PublicFlags[K] extends boolean ? K : never;
}[keyof PublicFlags];

/**
 * Type a route's `staticData.pageFlag` so a route can declare which page
 * kill switch gates it, and any `beforeLoad` can enforce it from the
 * `matches` array via {@link requireEnabledPages}. See that helper for why
 * routes nested under an auth-guarded layout use this instead of an inline
 * `requirePageFlag` call.
 */
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    pageFlag?: PageFlagKey;
  }
}

/**
 * Throw `notFound()` when a page's kill switch is off. The primitive most
 * routes use: call it first in `beforeLoad`, then run the route's own auth
 * guard (`requirePermission`, `requireApproved`, etc.) so a switched-off
 * page 404s uniformly regardless of who's asking.
 */
export async function requirePageFlag(
  queryClient: QueryClient,
  page: PageFlagKey,
): Promise<void> {
  const flags = await queryClient.ensureQueryData(publicFlagsQueryOptions());
  if (!flags.pages[page]) {
    throw notFound();
  }
}

/**
 * Enforce the `pages.*` kill switch for every matched route that declares
 * a `staticData.pageFlag`, throwing `notFound()` for the first one that's
 * off.
 *
 * This is the ordering-safe variant of {@link requirePageFlag}. TanStack
 * runs `beforeLoad` parent-to-child, so a leaf route that calls
 * `requirePageFlag` *after* an auth-guarded parent layout (`/gear`, `/my`,
 * `/members/_tabs`, `/feedback/_tabs`) never gets the chance to 404 an
 * anonymous / unauthorized visitor — the parent's redirect fires first. By
 * declaring the flag in `staticData` and calling this from the PARENT's
 * `beforeLoad` (before its auth guard) AND from the leaf (so sibling-tab
 * navigation, where the parent match stays and its `beforeLoad` doesn't
 * re-run, still checks the new leaf), a disabled page 404s uniformly
 * regardless of who's asking. Both call sites read the same cached
 * snapshot, so the double-check is free.
 *
 * **The leaf half of that pair should call `requirePageFlag` with its own
 * key, not this helper.** Two reasons, one correctness-neutral and one
 * load-bearing:
 *
 *  1. Equivalence — the leaf's own `staticData.pageFlag` is the only
 *     gated entry in its match chain whenever the layouts above it are
 *     flag-less (true for `/my`, `/gear`, `/members/_tabs`,
 *     `/feedback/_tabs`), so walking `matches` there just re-finds the
 *     key the leaf already knows statically. Ordering doesn't matter on
 *     sibling-tab navigation because the parent's auth guard isn't
 *     re-running.
 *  2. Type-instantiation cost — `matches` on the `beforeLoad` argument is
 *     typed `Array<RouteMatch<..., ResolveAllContext<TParentRoute, ...,
 *     TBeforeLoadFn>, ...>>`, i.e. it depends on the very `beforeLoad`
 *     being defined, and resolves every ancestor's context in turn.
 *     TypeScript only pays for that when the property is actually
 *     destructured, and at four levels deep (`/my/gear/`) touching it
 *     pushed `createFileRoute` over the instantiation-depth limit with
 *     TS2589. Reading `matches` in a shallow layout route is cheap;
 *     reading it in a deep leaf is not.
 *
 * So: `matches` walks belong in the shallow parent layout, and leaves
 * name their own flag. Do NOT "simplify" the leaves back to this helper —
 * it reintroduces TS2589 on the deepest routes.
 */
export async function requireEnabledPages(
  queryClient: QueryClient,
  matches: ReadonlyArray<{ staticData: { pageFlag?: PageFlagKey } }>,
): Promise<void> {
  const gated = matches.filter((match) => match.staticData.pageFlag);
  if (gated.length === 0) {
    return;
  }
  const flags = await queryClient.ensureQueryData(publicFlagsQueryOptions());
  for (const match of gated) {
    const key = match.staticData.pageFlag;
    if (key && !flags.pages[key]) {
      throw notFound();
    }
  }
}

/**
 * Throw `notFound()` when a *feature* flag is off.
 *
 * The sibling of {@link requirePageFlag} for the `features.*` category.
 * Kept separate rather than widening `requirePageFlag`, because the two
 * categories mean different things and the type should say so: a page flag
 * only ever hides-and-404s a page, while a feature flag also governs
 * behaviour (the header bell, server write actions). Feature flags are also
 * flat — no section cascade — so they read the snapshot's top-level fields
 * rather than its `pages` map.
 */
export async function requireFeatureFlag(
  queryClient: QueryClient,
  feature: FeatureFlagField,
): Promise<void> {
  const flags = await queryClient.ensureQueryData(publicFlagsQueryOptions());
  if (!flags[feature]) {
    throw notFound();
  }
}

/**
 * Convenience for anonymous-capable public pages: enforce the page flag,
 * then delegate to `requireViewPermission` (which honors the
 * `role_anonymous` grant so signed-out visitors keep access). Returns the
 * principal (or null for an anonymous viewer) so loaders can branch on
 * auth state.
 */
export async function requirePageEnabled(
  queryClient: QueryClient,
  page: PageFlagKey,
  permission: string,
): Promise<Principal | null> {
  await requirePageFlag(queryClient, page);
  return requireViewPermission(queryClient, permission);
}
