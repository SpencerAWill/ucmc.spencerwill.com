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
import { publicFlagsQueryOptions } from "./queries";

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
