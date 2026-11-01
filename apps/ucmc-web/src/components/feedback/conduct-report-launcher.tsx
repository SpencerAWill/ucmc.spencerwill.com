/**
 * Opens the conduct report dialog from the user menu ("Report Conduct").
 *
 * Feature-blind, like `feedback-launcher.tsx`: the menu (in
 * `features/auth`) calls `open()`, and `AppLayout` provides the context
 * and mounts the dialog from `features/conduct`.
 */
import { createContext, useContext, useMemo, useState } from "react";

interface LauncherValue {
  canReport: boolean;
  open: () => void;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

const LauncherContext = createContext<LauncherValue | null>(null);

export function ConductReportLauncherProvider({
  canReport,
  children,
}: {
  canReport: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const value = useMemo<LauncherValue>(
    () => ({
      canReport,
      open: () => setOpen(true),
      isOpen: isOpen && canReport,
      setOpen,
    }),
    [canReport, isOpen],
  );
  return (
    <LauncherContext.Provider value={value}>
      {children}
    </LauncherContext.Provider>
  );
}

const NO_LAUNCHER = { canReport: false, open: () => {} };

/** For triggers: whether reporting is possible, and how to start it. */
export function useConductReportLauncher(): {
  canReport: boolean;
  open: () => void;
} {
  const value = useContext(LauncherContext);
  return value === null
    ? NO_LAUNCHER
    : { canReport: value.canReport, open: value.open };
}

/** For the dialog. */
export function useConductReportLauncherState(): {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
} {
  const value = useContext(LauncherContext);
  return value === null
    ? { isOpen: false, setOpen: () => {} }
    : { isOpen: value.isOpen, setOpen: value.setOpen };
}
