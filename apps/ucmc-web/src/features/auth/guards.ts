/**
 * Route guards for use in TanStack Router `beforeLoad` hooks. Each guard
 * reads the cached session (populated by the root loader), redirects
 * when the precondition isn't met, and returns the principal so the
 * route gets it typed.
 */
import type { QueryClient } from "@tanstack/react-query";
import { notFound, redirect } from "@tanstack/react-router";

import {
  SESSION_QUERY_KEY,
  sessionQueryOptions,
} from "#/features/auth/api/use-auth";
import { getProofFn } from "#/features/auth/server/server-fns";
import { effectivePermissions } from "#/server/auth/emulation";
import type { Principal } from "#/server/auth/principal.server";
import { myWaiverStatusQueryOptions } from "#/features/waivers/api/queries";
import type { WaiverStatus } from "#/features/waivers/api/queries";

interface CachedSession {
  principal: Principal | null;
  anonymousPermissions: string[];
  emulatedRole: string | null;
}

async function getSession(queryClient: QueryClient): Promise<CachedSession> {
  const cached = queryClient.getQueryData<CachedSession>(SESSION_QUERY_KEY);
  if (cached) {
    return cached;
  }
  return queryClient.ensureQueryData(sessionQueryOptions());
}

async function getPrincipal(
  queryClient: QueryClient,
): Promise<Principal | null> {
  return (await getSession(queryClient)).principal;
}

/**
 * The permissions a *route* should be gated on: the previewed role's
 * grants while "View as" is active, the real set otherwise.
 *
 * Guards read the preview so a page hidden from the previewed role is
 * also unreachable by URL — otherwise emulation only filters the nav and
 * typing the path walks straight in, which is the whole reason this
 * exists. Server actions are untouched and keep enforcing the real
 * principal, so this is fidelity, not authorization: the preview can
 * only ever narrow (see `#/server/auth/emulation`).
 *
 * Deliberately NOT applied to `requireAuth` / `requireApproved` /
 * `requireCurrentWaiver`: those gate on account *status*, which a role
 * preview doesn't change. Keeping them on the real principal is what
 * stops a preview from locking an admin out of their own `/my/*` pages.
 */
export async function effectivePermissionsFor(
  queryClient: QueryClient,
  principal: Principal,
): Promise<string[]> {
  const session = await getSession(queryClient);
  return effectivePermissions(principal, session.emulatedRole);
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
  const granted = await effectivePermissionsFor(queryClient, principal);
  if (!granted.includes(permission)) {
    throw redirect({ to: "/" });
  }
  return principal;
}

/**
 * The permissions that grant read access to waiver standing —
 * `waivers:verify` implies `waivers:view` and there is no
 * implication mechanism in the RBAC tables, so the OR is expressed at
 * every gate. Named once here so the server helper
 * (`requireWaiverViewer`), the route guard, the sidebar entry, and the
 * waiver card on `/members/$publicId` can't drift into disagreeing
 * about who may read an attestation.
 *
 * Lives in `features/auth` rather than `features/waivers` because
 * shared chrome (`components/layouts/app-layout.tsx`) has to reach it
 * and this module is the exempted foundational auth surface.
 */
export const WAIVER_VIEW_PERMISSIONS = [
  "waivers:view",
  "waivers:verify",
] as const;

/**
 * The submit/manage pairs that grant access to each feedback surface.
 *
 * Same rationale as `WAIVER_VIEW_PERMISSIONS`: `*:manage` implies `*:submit`
 * for the purpose of *reaching* the surface (a manager triages a backlog
 * they may never post to), there's no implication mechanism in the RBAC
 * tables, and five places ask the question — the sidebar entry, the tab
 * bar, and all three `/feedback` routes. Spelled out at each one, they
 * drift; the club/site pair splitting out of a single `feedback:*` in
 * migration 0064 is exactly the kind of change that does it.
 */
export const CLUB_FEEDBACK_PERMISSIONS = [
  "club_feedback:submit",
  "club_feedback:manage",
] as const;

export const SITE_FEEDBACK_PERMISSIONS = [
  "site_feedback:submit",
  "site_feedback:manage",
] as const;

/**
 * Require a signed-in, approved user who holds AT LEAST ONE of
 * `permissions`. Same redirect behaviour as `requirePermission`.
 *
 * Exists for read/write permission pairs where the write permission
 * implies the read one — `waivers:view` / `waivers:verify` today. There
 * is no permission-implication mechanism in the RBAC tables, so the OR
 * has to be expressed at the gate; doing it here keeps route guards from
 * hand-rolling `includes() || includes()` chains that drift apart.
 */
export async function requireAnyPermission(
  queryClient: QueryClient,
  permissions: readonly string[],
): Promise<Principal> {
  const principal = await requireApproved(queryClient);
  const granted = await effectivePermissionsFor(queryClient, principal);
  if (!permissions.some((p) => granted.includes(p))) {
    throw redirect({ to: "/" });
  }
  return principal;
}

/**
 * Variant of `requirePermission` that throws `notFound()` instead of
 * redirecting when an approved user lacks the permission. Use this for
 * routes that should be invisible to non-holders — direct navigation
 * surfaces the app's notFound boundary rather than bouncing them home
 * (which can confuse: "I clicked a link, why did I land at /?").
 *
 * Unauthenticated / unapproved users still flow through the normal
 * registration funnel via `requireApproved`.
 */
export async function requirePermissionOrNotFound(
  queryClient: QueryClient,
  permission: string,
): Promise<Principal> {
  const principal = await requireApproved(queryClient);
  const granted = await effectivePermissionsFor(queryClient, principal);
  if (!granted.includes(permission)) {
    throw notFound();
  }
  return principal;
}

/**
 * Variant of `requirePermissionOrNotFound` that does NOT funnel
 * unauthenticated users through the registration flow. Use for public
 * pages whose visibility is permission-gated but where a viewer
 * permission may legitimately be granted to `role_anonymous`. The
 * session query already carries the anonymous-role permission set
 * (see `getSessionFn`); we read from that for null-principal cases.
 *
 * Behaviour matrix:
 *   - Anonymous + permission granted to role_anonymous → returns null,
 *     route renders for the unauthenticated viewer.
 *   - Anonymous + permission NOT granted               → notFound().
 *   - Authenticated + permission granted              → returns the principal.
 *   - Authenticated + permission NOT granted          → notFound().
 *
 * Returns the principal (or null for anonymous) so route loaders can
 * branch on auth state if they need to.
 */
export async function requireViewPermission(
  queryClient: QueryClient,
  permission: string,
): Promise<Principal | null> {
  const session = await getSession(queryClient);
  if (session.principal) {
    const granted = effectivePermissions(
      session.principal,
      session.emulatedRole,
    );
    if (granted.includes(permission)) {
      return session.principal;
    }
    throw notFound();
  }
  if (session.anonymousPermissions.includes(permission)) {
    return null;
  }
  throw notFound();
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
 *   - signed-in user *with* a profile → /my/profile (already registered)
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
 * `/my/waiver` so they see the "how to get attested" instructions.
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
    throw redirect({ to: "/my/waiver" });
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
    throw redirect({ to: "/my/profile" });
  }
  return { source: "session", email: principal.primaryEmail };
}
