import {
  PASSKEY_LIST_QUERY_KEY,
  PROFILE_QUERY_KEY,
  SESSION_QUERY_KEY,
} from "#/features/auth/api/query-keys";
import { getProfileFn, getSessionFn } from "#/features/auth/server/server-fns";
import { listPasskeysFn } from "#/features/auth/server/webauthn-fns";

/**
 * Current principal — used by useAuth, the root loader's prefetch, and
 * the route guards. 60s staleTime is long enough that most navigations
 * avoid a refetch, short enough that an approval flip or sign-out is
 * reflected promptly without a hard reload. Privileged actions still
 * invalidate explicitly via the auth hook's `refresh()`.
 */
export function sessionQueryOptions() {
  return {
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => getSessionFn(),
    staleTime: 60_000,
  } as const;
}

/**
 * Current user's profile + emergency contacts. Used by the
 * /account Profile and Details tabs to pre-fill their forms with
 * existing values.
 */
export function profileQueryOptions() {
  return {
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => getProfileFn(),
  } as const;
}

/**
 * Registered passkey list for the signed-in user. Server returns
 * `{ ok: true, passkeys }` on success and `{ ok: false }` for the
 * very narrow case where no session exists; we collapse to `[]` so
 * the consuming list always has a stable shape.
 */
export function passkeyListQueryOptions() {
  return {
    queryKey: PASSKEY_LIST_QUERY_KEY,
    queryFn: async () => {
      const result = await listPasskeysFn();
      return result.ok ? result.passkeys : [];
    },
  } as const;
}
