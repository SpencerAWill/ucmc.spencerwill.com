import { useQuery, useQueryClient } from "@tanstack/react-query";

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
  const query = useQuery(sessionQueryOptions());
  const principal = query.data?.principal ?? null;

  return {
    principal,
    isLoading: query.isLoading,
    isAuthenticated: principal !== null,
    isApproved: principal?.status === "approved",
    hasProfile: principal?.hasProfile ?? false,
    hasPermission: (name: string) =>
      principal?.permissions.includes(name) ?? false,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY }),
    signOut: async () => {
      await signOutFn();
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  };
}
