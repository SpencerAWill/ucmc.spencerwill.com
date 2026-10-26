import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageContainer } from "#/components/layouts/page-container";
import { requireAnyPermission } from "#/features/auth/guards";
import { siteSettingsQueryOptions } from "#/features/settings/api/queries";
import { SettingsCategories } from "#/features/settings/components/settings-categories";
import { SETTINGS_PAGE_PERMISSIONS } from "#/server/settings/settings-registry";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context, location }) => {
    // Per-key gating: anyone who can edit at least one setting gets in,
    // and the page renders only what they can edit.
    await requireAnyPermission(
      { context, location },
      SETTINGS_PAGE_PERMISSIONS,
    );
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(siteSettingsQueryOptions());
  },
  component: SettingsPage,
});

function SettingsPage() {
  const query = useQuery(siteSettingsQueryOptions());

  return (
    <PageContainer width="app" className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Site settings</h1>
        <p className="text-sm text-muted-foreground">
          Runtime-editable configuration for the site. All changes are recorded
          in the audit log. Static legal/compliance copy is not editable here —
          it lives in versioned source files.
        </p>
      </header>

      <SettingsCategories entries={query.data} />
    </PageContainer>
  );
}
