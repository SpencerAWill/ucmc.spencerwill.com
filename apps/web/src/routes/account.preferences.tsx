import { createFileRoute } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import { useTheme } from "#/components/theme-provider";

export const Route = createFileRoute("/account/preferences")({
  component: PreferencesPage,
});

function PreferencesPage() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium">Preferences</h2>
        <p className="text-muted-foreground text-sm">
          Personalize how the site looks for you on this device.
        </p>
      </header>
      <div className="space-y-2">
        <p className="text-sm font-medium">Theme</p>
        <div className="flex gap-2">
          {(["light", "dark", "system"] as const).map((mode) => (
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
