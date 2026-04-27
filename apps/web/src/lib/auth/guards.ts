/**
 * Route guards for use in TanStack Router `beforeLoad` hooks. Each guard
 * reads the cached session (populated by the root loader), redirects
 * when the precondition isn't met, and returns the principal so the
 * route gets it typed.
 */
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { SESSION_QUERY_KEY, sessionQueryOptions } from "#/lib/auth/use-auth";
import type { Principal } from "#/server/auth/principal.server";
import type { EmailProof } from "#/server/auth/proof-cookie.server";
import { getProofFn } from "#/server/auth/server-fns";

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
 * Require a valid email-verification proof cookie (set by the magic-link
 * callback). Distinct from `requireAuth` — proof-only holders haven't
 * opened a session yet. Used by `/register/profile` to gate first-time
 * profile submission.
 */
export async function requireProof(): Promise<EmailProof> {
  const { proof } = await getProofFn();
  if (!proof) {
    throw redirect({ to: "/sign-in", search: { register: true } });
  }
  return proof;
}
