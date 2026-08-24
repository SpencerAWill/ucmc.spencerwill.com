/**
 * Role emulation ("View as") — the client half: the setter and the
 * cookie write.
 *
 * The *value* is no longer owned here. It lives in the `ucmc_view_as`
 * cookie and reaches the app through the session payload
 * (`getSessionAction` → `emulatedRole`), because route guards run in
 * `beforeLoad`, which executes on the server for a hard navigation —
 * the `localStorage` this used to read is invisible there, so typing
 * the URL of a page the previewed role can't see walked straight in.
 * One source, read the same way on both sides.
 *
 * Switching writes the cookie (for the next server render) and patches
 * the session cache in place (for this one), rather than invalidating
 * and waiting on a refetch: the cache is what both the chrome and the
 * guards read, so updating it is what keeps them from disagreeing
 * mid-switch.
 */
import { useQueryClient } from "@tanstack/react-query";
import { createContext, use } from "react";

import { SESSION_QUERY_KEY } from "#/features/auth/api/query-keys";
import { VIEW_AS_COOKIE_NAME } from "#/server/auth/emulation";

type ViewModeState = {
  /** Set the emulated role name, or null to clear. */
  setEmulatedRole: (role: string | null) => void;
};

const ViewModeContext = createContext<ViewModeState | undefined>(undefined);

/** One year — long enough that a preview survives a browser restart. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeCookie(role: string | null) {
  // Not `httpOnly` by necessity (the client writes it) and not
  // `__Host-`-prefixed (that needs Secure, which local http dev can't
  // set). It carries no authority — `resolveEmulatedRole` validates it
  // against the principal's own `rolePermissionMap`, so a forged value
  // can only ever narrow.
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const base = `${VIEW_AS_COOKIE_NAME}=`;
  document.cookie = role
    ? `${base}${encodeURIComponent(role)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`
    : `${base}; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const setEmulatedRole = (role: string | null) => {
    writeCookie(role);
    // Patch the cache the guards and the chrome both read. `undefined`
    // when the session hasn't loaded yet, in which case there's nothing
    // to preview against and the cookie alone is correct.
    queryClient.setQueryData(
      SESSION_QUERY_KEY,
      (prev: { emulatedRole: string | null } | undefined) =>
        prev ? { ...prev, emulatedRole: role } : prev,
    );
  };

  return (
    <ViewModeContext value={{ setEmulatedRole }}>{children}</ViewModeContext>
  );
}

export function useViewMode() {
  const context = use(ViewModeContext);
  if (context === undefined) {
    throw new Error("useViewMode must be used within a ViewModeProvider");
  }
  return context;
}
