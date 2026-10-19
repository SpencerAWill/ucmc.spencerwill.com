import { createFileRoute, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";
import { requireApproved } from "#/features/auth/guards";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

/**
 * Parent layout for the entire `/my/*` personal namespace. Runs the
 * approved-only guard once so children (the `_tabs` account group,
 * `my.gear.*`, future `my.dashboard` / `my.trips`) inherit it. The guard
 * reads the leaf's location from the `beforeLoad` args, so an anonymous
 * user deep-linking into something like `/my/security?foo=1` lands back
 * at the same path and search after sign-in.
 *
 * Round-trip path: `requireAuth` writes the path into
 * `/sign-in?redirect=...`; the sign-in page forwards it to
 * `MagicLinkForm` and `SignInWithPasskeyButton`; the magic-link form
 * passes it to `requestMagicLinkFn` which embeds it in the emailed
 * `/auth/callback?token=...&redirect=...` URL; every hop re-checks it
 * with `safeReturnPath` before using it.
 */
export const Route = createFileRoute("/my")({
  beforeLoad: async ({ context, location, matches }) => {
    // Enforce the leaf's `pages.*` kill switch before the approved-only
    // guard so a disabled page 404s uniformly instead of redirecting an
    // anonymous visitor to sign-in first.
    await requireEnabledPages(context.queryClient, matches);
    await requireApproved({ context, location });
  },
  component: () => <Outlet />,
  errorComponent: RouteErrorFallback,
});
