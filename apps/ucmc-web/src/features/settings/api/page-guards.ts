/**
 * Route guard for flag-gated sidebar pages.
 *
 * Composes a page's kill switch (a boolean in the public-flags snapshot)
 * with its view permission. Seeded for the public-site section (Gear Cave
 * → History) but intended to grow as more sidebar pages become
 * toggleable — a handful (e.g. Settings, Audit) intentionally stay
 * always-on and never get a flag.
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
import { publicFlagsQueryOptions } from "./queries";
import type { PublicFlags } from "#/features/settings/server/settings-fns";

/**
 * Require a flag-gated sidebar page to be enabled AND viewable.
 *
 * Reads the public-flags snapshot first: when the page's kill switch is
 * off, throws `notFound()` for everyone regardless of permission — so a
 * disabled page 404s on direct navigation, matching how it disappears
 * from the sidebar. When on, delegates to `requireViewPermission` for the
 * page's view permission (which honors the `role_anonymous` grant, so
 * public pages stay reachable by signed-out visitors).
 *
 * Returns the principal (or null for an anonymous viewer) so loaders can
 * branch on auth state if they need to.
 */
export async function requirePageEnabled(
  queryClient: QueryClient,
  flag: keyof PublicFlags,
  permission: string,
): Promise<Principal | null> {
  const flags = await queryClient.ensureQueryData(publicFlagsQueryOptions());
  if (!flags[flag]) {
    throw notFound();
  }
  return requireViewPermission(queryClient, permission);
}
