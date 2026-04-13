import { createContext, use, useEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";

export const THEME_STORAGE_KEY = "ucmc-ui-theme";

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined,
);

function applyTheme(theme: Theme) {
  const root = window.document.documentElement;
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

function readStoredTheme(defaultTheme: Theme): Theme {
  if (typeof window === "undefined") {
    return defaultTheme;
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return defaultTheme;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  // On mount, hydrate from localStorage. The inline script in __root.tsx has
  // already applied the correct class, so no visual flash.
  useEffect(() => {
    setThemeState(readStoredTheme(defaultTheme));
  }, [defaultTheme]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Respond to OS-level theme changes while in "system" mode.
  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const value: ThemeProviderState = {
    theme,
    setTheme: (next) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      setThemeState(next);
    },
  };

  return <ThemeProviderContext value={value}>{children}</ThemeProviderContext>;
}

export function useTheme() {
  const context = use(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
