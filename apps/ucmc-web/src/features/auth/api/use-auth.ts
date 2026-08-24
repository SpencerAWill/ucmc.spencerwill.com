import { useQuery, useQueryClient } from "@tanstack/react-query";

import { SESSION_QUERY_KEY } from "#/features/auth/api/query-keys";
import { sessionQueryOptions } from "#/features/auth/api/queries";
import { signOutFn } from "#/features/auth/server/server-fns";
import { effectivePermissions } from "#/server/auth/emulation";

// Re-exported so legacy importers can keep their call sites unchanged.
// Canonical location is `./query-keys`; canonical query options are in
// `./queries`.
export { SESSION_QUERY_KEY, sessionQueryOptions };

export function useAuth() {
  const queryClient = useQueryClient();
  const query = useQuery(sessionQueryOptions());
  const principal = query.data?.principal ?? null;
  const anonymousPermissions = query.data?.anonymousPermissions ?? [];

  // Show the emulation UI when the user has multiple roles to switch
  // between, or when they're a system admin (who can emulate any role
  // on the site, even ones they don't personally hold).
  const isSystemAdmin = principal?.isSystemAdmin ?? false;
  const isElevated = isSystemAdmin || (principal?.roles.length ?? 0) > 1;

  // The preview comes from the session payload, which the server
  // resolved from the `ucmc_view_as` cookie — the same value the route
  // guards read, so the chrome and the guards can't disagree. It arrives
  // already validated against `rolePermissionMap`.
  const activeEmulatedRole = query.data?.emulatedRole ?? null;

  // What this viewer should be *shown*. Server actions still enforce
  // `principal.permissions`; a preview only narrows what's drawn and
  // which routes the client-side guards allow.
  const granted = principal
    ? effectivePermissions(principal, activeEmulatedRole)
    : anonymousPermissions;

  return {
    principal,
    isLoading: query.isLoading,
    isAuthenticated: principal !== null,
    isApproved: principal?.status === "approved",
    hasProfile: principal?.hasProfile ?? false,
    hasPermission: (name: string) => granted.includes(name),
    /**
     * Client twin of `requireAnyPermission` for read/write permission
     * pairs where the write implies the read (see
     * `WAIVER_VIEW_PERMISSIONS`). Reads the same effective set as
     * `hasPermission`, so it respects a preview for free — a
     * hand-rolled `includes() || includes()` against
     * `principal.permissions` would bypass it silently.
     */
    hasAnyPermission: (names: readonly string[]) =>
      names.some((name) => granted.includes(name)),
    emulatedRole: activeEmulatedRole,
    isElevated,
    isSystemAdmin,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
    signOut: async () => {
      await signOutFn();
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  };
}
