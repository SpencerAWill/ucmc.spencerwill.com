/**
 * The body of /settings: the stale-review tray and one section per
 * category, filtered to what the viewer can edit.
 *
 * The server already returns only the editable keys (`listSiteSettingsFn`);
 * this is the page agreeing with it, so a `notice:manage`-only officer gets
 * one Notice section instead of a page of headings over settings that will
 * never load. It reads `hasPermission`, which honours a role preview, so
 * "View as" shows what that role would see here too.
 *
 * Lives in the feature rather than the route so it can be rendered in a
 * test — a `createFileRoute` module can't be mounted without a router.
 */
import { useAuth } from "#/features/auth/api/use-auth";
import type { SiteSettingsSnapshot } from "#/features/settings/server/settings-fns";
import {
  CATEGORY_LABELS,
  getMeta,
  isStale,
  keysByCategory,
  SETTING_CATEGORIES,
  settingPermissionOf,
} from "#/server/settings/settings-registry";
import type {
  SettingCategory,
  SettingKey,
} from "#/server/settings/settings-registry";
import { NoticePanel } from "./notice-panel";
import { PageFlagsPanel } from "./page-flags-panel";
import { SettingRow } from "./setting-row";

export function SettingsCategories({
  entries,
}: {
  entries: SiteSettingsSnapshot | undefined;
}) {
  const { hasPermission } = useAuth();
  const grouped = keysByCategory();
  const canEdit = (key: SettingKey) => hasPermission(settingPermissionOf(key));

  return (
    <>
      <StaleSummary canEdit={canEdit} />

      {SETTING_CATEGORIES.map((category) => {
        const keys = grouped[category].filter(canEdit);
        if (keys.length === 0) {
          return null;
        }
        // The `pages` category is ~40 homogeneous booleans with a section
        // hierarchy — it gets a compact tree instead of one card per row.
        // See `PageFlagsPanel` for why.
        if (category === "pages") {
          return <PageFlagsPanel key={category} entries={entries} />;
        }
        // The notice gets a live preview of the bar above its rows.
        if (category === "notice") {
          return <NoticePanel key={category} entries={entries} />;
        }
        return (
          <CategorySection
            key={category}
            category={category}
            keys={keys}
            entries={entries}
          />
        );
      })}
    </>
  );
}

function CategorySection({
  category,
  keys,
  entries,
}: {
  category: SettingCategory;
  keys: SettingKey[];
  entries: SiteSettingsSnapshot | undefined;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{CATEGORY_LABELS[category]}</h2>
      <div className="space-y-3">
        {keys.map((key) => {
          if (entries === undefined) {
            return <SettingRowSkeleton key={key} />;
          }
          // The snapshot holds only the keys this viewer can edit.
          const entry = entries[key];
          return entry === undefined ? null : (
            <SettingRow key={key} settingKey={key} entry={entry} />
          );
        })}
      </div>
    </section>
  );
}

function SettingRowSkeleton() {
  return <div className="h-20 animate-pulse rounded-lg border bg-muted/40" />;
}

/**
 * Aggregate "needs review" tray. Visible only when at least one setting
 * the viewer can edit is past `expiresAt`. Keeps officers honest about
 * flag hygiene without cluttering the page when everything is fresh —
 * and without nagging someone about a setting they can't change.
 */
function StaleSummary({ canEdit }: { canEdit: (key: SettingKey) => boolean }) {
  const grouped = keysByCategory();
  const overdue: SettingKey[] = [];
  for (const category of SETTING_CATEGORIES) {
    for (const key of grouped[category]) {
      if (canEdit(key) && isStale(getMeta(key))) {
        overdue.push(key);
      }
    }
  }
  if (overdue.length === 0) {
    return null;
  }
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
