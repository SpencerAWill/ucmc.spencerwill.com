import { createFileRoute, Outlet } from "@tanstack/react-router";

import { RouteErrorFallback } from "#/components/error-page";
import { requireApproved } from "#/features/auth/guards";

/**
 * Parent layout for the entire `/my/*` personal namespace. Runs the
 * approved-only guard once so children (`my.account.*`, future
 * `my.dashboard`, `my.gear`, `my.trips`) inherit it. Uses
 * `location.href` (path + search + hash, no origin) as the redirectFrom
 * so an anonymous user deep-linking into something like
 * `/my/account/security?foo=1#bar` lands back at the exact same URL
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
  beforeLoad: async ({ context, location }) => {
    await requireApproved(context.queryClient, location.href);
  },
  component: () => <Outlet />,
  errorComponent: RouteErrorFallback,
});
