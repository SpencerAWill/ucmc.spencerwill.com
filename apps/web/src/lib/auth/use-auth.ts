import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useViewMode } from "#/lib/auth/view-mode";
import { getSessionFn, signOutFn } from "#/server/auth/server-fns";

export const SESSION_QUERY_KEY = ["auth", "session"] as const;

export function sessionQueryOptions() {
  return {
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => getSessionFn(),
    // 60s is long enough that most navigations avoid a refetch, short
    // enough that an approval flip or sign-out is reflected promptly
    // without a hard reload. Privileged actions still invalidate
    // explicitly via `refresh()`.
    staleTime: 60_000,
  } as const;
}

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
