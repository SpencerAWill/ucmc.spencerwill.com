/**
 * Route guards for use in TanStack Router `beforeLoad` hooks. Each guard reads
 * the cached session (set by the root loader), redirects when the precondition
 * isn't met, and returns the principal so the route gets it typed.
 */
import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { SESSION_QUERY_KEY, sessionQueryOptions } from "#/lib/auth/use-auth";
import type { SessionPrincipal } from "#/server/auth/session";

async function getPrincipal(
  queryClient: QueryClient,
): Promise<SessionPrincipal | null> {
  const cached = queryClient.getQueryData<{
    principal: SessionPrincipal | null;
  }>(SESSION_QUERY_KEY);
  if (cached) return cached.principal;
  const fresh = await queryClient.ensureQueryData(sessionQueryOptions());
  return fresh.principal;
}

export async function requireAuth(
  queryClient: QueryClient,
  redirectFrom?: string,
): Promise<SessionPrincipal> {
  const principal = await getPrincipal(queryClient);
  if (!principal) {
    throw redirect({
      to: "/sign-in",
      search: redirectFrom ? { redirect: redirectFrom } : undefined,
    });
  }
  return principal;
}

export async function requireApproved(
  queryClient: QueryClient,
  redirectFrom?: string,
): Promise<SessionPrincipal> {
  const principal = await requireAuth(queryClient, redirectFrom);
  if (!principal.hasProfile) {
    throw redirect({ to: "/register/profile" });
  }
  if (principal.status !== "approved") {
    throw redirect({ to: "/register/pending" });
  }
  return principal;
}

export async function requirePermission(
  queryClient: QueryClient,
  permission: string,
): Promise<SessionPrincipal> {
  const principal = await requireApproved(queryClient);
  if (!principal.permissions.includes(permission)) {
    throw redirect({ to: "/" });
  }
  return principal;
}
