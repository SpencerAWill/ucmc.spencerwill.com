import { createContext, use, useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ucmc-emulated-role";

type ViewModeState = {
  /** The role name being emulated, or null for real permissions. */
  emulatedRole: string | null;
  /** Set the emulated role name, or null to clear. */
  setEmulatedRole: (role: string | null) => void;
};

const ViewModeContext = createContext<ViewModeState | undefined>(undefined);

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [emulatedRole, setRole] = useState<string | null>(null);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setRole(stored);
    }
  }, []);

  const setEmulatedRole = useCallback((role: string | null) => {
    if (role) {
      window.localStorage.setItem(STORAGE_KEY, role);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setRole(role);
  }, []);

  const value: ViewModeState = {
    emulatedRole,
    setEmulatedRole,
  };

  return <ViewModeContext value={value}>{children}</ViewModeContext>;
}

export function useViewMode() {
  const context = use(ViewModeContext);
  if (context === undefined) {
    throw new Error("useViewMode must be used within a ViewModeProvider");
  }
  return context;
}
