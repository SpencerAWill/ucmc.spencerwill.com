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
