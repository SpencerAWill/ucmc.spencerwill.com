import { createFileRoute } from "@tanstack/react-router";

import { useTheme } from "#/components/theme-provider";
import { Button } from "#/components/ui/button";

/**
 * Preferences tab. Currently just a theme toggle — per-device settings
 * that aren't tied to a user record. Future preferences (email
 * notifications, default trip visibility, etc.) will persist to D1 and
 * slot in under new section headers below.
 */
export const Route = createFileRoute("/account/preferences")({
  component: PreferencesPage,
});

const THEME_OPTIONS = ["light", "dark", "system"] as const;

function PreferencesPage() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium">Preferences</h2>
        <p className="text-sm text-muted-foreground">
          Personalize how the site looks for you on this device.
        </p>
      </header>
      <div className="space-y-2">
        <p className="text-sm font-medium">Theme</p>
        <div className="flex gap-2">
          {THEME_OPTIONS.map((mode) => (
            <Button
              key={mode}
              variant={theme === mode ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme(mode)}
            >
              {mode[0].toUpperCase() + mode.slice(1)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
