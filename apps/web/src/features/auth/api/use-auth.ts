import { useQuery, useQueryClient } from "@tanstack/react-query";

import { SESSION_QUERY_KEY } from "#/features/auth/api/query-keys";
import { sessionQueryOptions } from "#/features/auth/api/queries";
import { useViewMode } from "#/features/auth/api/view-mode";
import { signOutFn } from "#/features/auth/server/server-fns";

// Re-exported so legacy importers can keep their call sites unchanged.
// Canonical location is `./query-keys`; canonical query options are in
// `./queries`.
export { SESSION_QUERY_KEY, sessionQueryOptions };

export function useAuth() {
  const queryClient = useQueryClient();
  const { emulatedRole } = useViewMode();
  const query = useQuery(sessionQueryOptions());
  const principal = query.data?.principal ?? null;
  const anonymousPermissions = query.data?.anonymousPermissions ?? [];

  // Show the emulation dropdown when the user has more than one role.
  const isElevated = (principal?.roles.length ?? 0) > 1;

  // Resolve emulated permissions from the live principal data (not a
  // stale localStorage snapshot). If the emulated role was removed from
  // the user or doesn't exist in the map, treat it as no permissions.
  const activeEmulatedRole =
    emulatedRole && principal?.roles.includes(emulatedRole)
      ? emulatedRole
      : null;

  return {
    principal,
    isLoading: query.isLoading,
    isAuthenticated: principal !== null,
    isApproved: principal?.status === "approved",
    hasProfile: principal?.hasProfile ?? false,
    hasPermission: (name: string) => {
      if (principal) {
        // When emulating a role, check against that role's permissions
        // resolved from the live principal. UI-only — route guards use
        // the raw principal.
        if (activeEmulatedRole) {
          return principal.rolePermissionMap[activeEmulatedRole].includes(name);
        }
        return principal.permissions.includes(name);
      }
      return anonymousPermissions.includes(name);
    },
    emulatedRole: activeEmulatedRole,
    isElevated,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
    signOut: async () => {
      await signOutFn();
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  };
}
