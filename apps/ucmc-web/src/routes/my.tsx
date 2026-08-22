import { createFileRoute, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";
import { requireApproved } from "#/features/auth/guards";
import { requireEnabledPages } from "#/features/settings/api/page-guards";

/**
 * Parent layout for the entire `/my/*` personal namespace. Runs the
 * approved-only guard once so children (the `_tabs` account group,
 * `my.gear.*`, future `my.dashboard` / `my.trips`) inherit it. Uses
 * `location.href` (path + search + hash, no origin) as the redirectFrom
 * so an anonymous user deep-linking into something like
 * `/my/security?foo=1#bar` lands back at the exact same URL
 * after sign-in.
 *
 * Round-trip path: `requireAuth` writes the captured URL into
 * `/sign-in?redirect=...`; the sign-in page forwards it to
 * `MagicLinkForm` and `SignInWithPasskeyButton`; the magic-link form
 * passes it to `requestMagicLinkFn` which embeds it in the emailed
 * `/auth/callback?token=...&redirect=...` URL; both the callback and
 * the passkey paths re-validate `startsWith("/")` before navigating.
 */
export const Route = createFileRoute("/my")({
  beforeLoad: async ({ context, location, matches }) => {
    // Enforce the leaf's `pages.*` kill switch before the approved-only
    // guard so a disabled page 404s uniformly instead of redirecting an
    // anonymous visitor to sign-in first.
    await requireEnabledPages(context.queryClient, matches);
    await requireApproved(context.queryClient, location.href);
  },
  component: () => <Outlet />,
  errorComponent: RouteErrorFallback,
});
