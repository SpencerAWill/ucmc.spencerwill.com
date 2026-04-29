/**
 * Route guards for use in TanStack Router `beforeLoad` hooks. Each guard
 * reads the cached session (populated by the root loader), redirects
 * when the precondition isn't met, and returns the principal so the
 * route gets it typed.
 */
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import {
  SESSION_QUERY_KEY,
  sessionQueryOptions,
} from "#/features/auth/api/use-auth";
import { myWaiverStatusQueryOptions } from "#/features/auth/api/waiver-queries";
import type { Principal } from "#/server/auth/principal.server";
import { getProofFn } from "#/features/auth/server/server-fns";
import type { WaiverStatus } from "#/features/auth/server/waiver-fns";

async function getPrincipal(
  queryClient: QueryClient,
): Promise<Principal | null> {
  const cached = queryClient.getQueryData<{ principal: Principal | null }>(
    SESSION_QUERY_KEY,
  );
  if (cached) {
    return cached.principal;
  }
  const fresh = await queryClient.ensureQueryData(sessionQueryOptions());
  return fresh.principal;
}

/** Require a signed-in session. Redirects to /sign-in otherwise. */
export async function requireAuth(
  queryClient: QueryClient,
  redirectFrom?: string,
): Promise<Principal> {
  const principal = await getPrincipal(queryClient);
  if (!principal) {
    throw redirect({
      to: "/sign-in",
      search: redirectFrom ? { redirect: redirectFrom } : undefined,
    });
  }
  return principal;
}

/**
 * Require a signed-in, approved user with a completed profile. Steps
 * through the registration funnel: no profile → /register/profile, not
 * yet approved → /register/pending.
 */
export async function requireApproved(
  queryClient: QueryClient,
  redirectFrom?: string,
): Promise<Principal> {
  const principal = await requireAuth(queryClient, redirectFrom);
  if (!principal.hasProfile) {
    throw redirect({ to: "/register/profile" });
  }
  if (principal.status === "deactivated") {
    throw redirect({ to: "/deactivated" });
  }
  if (principal.status !== "approved") {
    throw redirect({ to: "/register/pending" });
  }
  return principal;
}

/**
 * Require a signed-in, approved user who holds a specific permission.
 * Layers on top of `requireApproved` — kicks unapproved users into the
 * registration funnel, and sends approved users without the permission
 * back to `/` (they're signed in and approved but not authorized for
 * this particular page).
 */
export async function requirePermission(
  queryClient: QueryClient,
  permission: string,
): Promise<Principal> {
  const principal = await requireApproved(queryClient);
  if (!principal.permissions.includes(permission)) {
    throw redirect({ to: "/" });
  }
  return principal;
}

/**
 * Authorization context for the `/register/profile` page. Accepts either
 * a fresh email-verification proof cookie OR a returning-user session
 * for someone who hasn't completed a profile yet — mirrors the magic-link
 * callback's two paths into this route:
 *
 *   no user row yet              → consume sets proof cookie  → here
 *   user row exists, no profile  → consume opens a session    → here
 *
 * Anyone else gets bounced:
 *   - no proof and no session  → /sign-in?register=true (start over)
 *   - signed-in user *with* a profile → /account (already registered)
 *
 * The shared shape exposes `email` regardless of source, so the form
 * can render its read-only field and the server's submit action (which
 * reads either cookie itself) stays the source of truth.
 */
export type RegistrationContext =
  | { source: "proof"; email: string }
  | { source: "session"; email: string };

/**
 * Returns the caller's current-cycle waiver status (cached) without
 * redirecting. Use this from the layout to render a "waiver missing"
 * banner without blocking navigation. Pre-supposes the caller is
 * signed in; safe to call from inside a `requireApproved`'d route.
 */
export async function getCurrentWaiverStatus(
  queryClient: QueryClient,
): Promise<WaiverStatus> {
  return queryClient.ensureQueryData(myWaiverStatusQueryOptions());
}

/**
 * Hard gate for routes that require an active paper-waiver attestation
 * for the current academic cycle (e.g. trip RSVP, equipment checkout,
 * future participation-gated actions). Layers on top of `requireApproved`
 * — no profile / not approved / deactivated all redirect first; an
 * approved member without a current attestation gets bounced to
 * `/account/waiver` so they see the "how to get attested" instructions.
 *
 * Today no production route invokes this. It exists so the future
 * `/trips`-style features can drop it into their `beforeLoad` without
 * re-deriving the cycle/version comparison.
 */
export async function requireCurrentWaiver(
  queryClient: QueryClient,
  redirectFrom?: string,
): Promise<{ principal: Principal; waiver: WaiverStatus }> {
  const principal = await requireApproved(queryClient, redirectFrom);
  const waiver = await getCurrentWaiverStatus(queryClient);
  if (!waiver.current) {
    throw redirect({ to: "/account/waiver" });
  }
  return { principal, waiver };
}

export async function requireRegistrationContext(
  queryClient: QueryClient,
): Promise<RegistrationContext> {
  // Proof cookie is the first-time-registrant path; check it first so a
  // stale session never shadows a freshly-verified email.
  const { proof } = await getProofFn();
  if (proof) {
    return { source: "proof", email: proof.email };
  }
  const principal = await getPrincipal(queryClient);
  if (!principal) {
    throw redirect({ to: "/sign-in", search: { register: true } });
  }
  if (principal.hasProfile) {
    throw redirect({ to: "/account" });
  }
  return { source: "session", email: principal.email };
}
