import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { requirePermission } from "#/features/auth/guards";
import { siteSettingsQueryOptions } from "#/features/settings/api/queries";
import { SettingRow } from "#/features/settings/components/setting-row";
import {
  CATEGORY_LABELS,
  getMeta,
  isStale,
  keysByCategory,
  SETTING_CATEGORIES,
} from "#/features/settings/server/settings-registry";
import type {
  SettingCategory,
  SettingKey,
  SettingValue,
} from "#/features/settings/server/settings-registry";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "settings:manage");
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(siteSettingsQueryOptions());
  },
  component: SettingsPage,
});

function SettingsPage() {
  const query = useQuery(siteSettingsQueryOptions());
  const grouped = keysByCategory();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Site settings</h1>
        <p className="text-sm text-muted-foreground">
          Runtime-editable configuration for the site. All changes are recorded
          in the audit log. Static legal/compliance copy is not editable here —
          it lives in versioned source files.
        </p>
      </header>

      <StaleSummary />

      {SETTING_CATEGORIES.map((category) => {
        const keys = grouped[category];
        if (keys.length === 0) return null;
        return (
          <CategorySection
            key={category}
            category={category}
            keys={keys}
            values={query.data}
          />
        );
      })}
    </div>
  );
}

function CategorySection({
  category,
  keys,
  values,
}: {
  category: SettingCategory;
  keys: SettingKey[];
  values: { [TKey in SettingKey]: SettingValue<TKey> } | undefined;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{CATEGORY_LABELS[category]}</h2>
      <div className="space-y-3">
        {keys.map((key) =>
          values === undefined ? (
            <SettingRowSkeleton key={key} />
          ) : (
            <SettingRow key={key} settingKey={key} value={values[key]} />
          ),
        )}
      </div>
    </section>
  );
}

function SettingRowSkeleton() {
  return <div className="h-20 animate-pulse rounded-lg border bg-muted/40" />;
}

/**
 * Aggregate "needs review" tray. Visible only when at least one setting
 * is past `expiresAt`. Keeps officers honest about flag hygiene without
 * cluttering the page when everything is fresh.
 */
function StaleSummary() {
  const grouped = keysByCategory();
  const overdue: SettingKey[] = [];
  for (const category of SETTING_CATEGORIES) {
    for (const key of grouped[category]) {
      if (isStale(getMeta(key))) overdue.push(key);
    }
  }
  if (overdue.length === 0) return null;
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
      <p className="text-sm font-medium">
        {overdue.length} setting{overdue.length === 1 ? "" : "s"} past their
        review date
      </p>
      <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
        {overdue.map((key) => (
          <li key={key}>
            <code className="font-mono">{key}</code> — {getMeta(key).label}
          </li>
        ))}
      </ul>
    </div>
  );
}
