/**
 * /settings shows each viewer only the categories they can edit. The
 * server already filters the snapshot; this is the page agreeing with it,
 * so a notice:manage-only officer sees one Notice section rather than a
 * page of skeletons for settings that will never load.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "#/components/ui/tooltip";
import { SettingsCategories } from "#/features/settings/components/settings-categories";
import type { SiteSettingsSnapshot } from "#/features/settings/server/settings-fns";
import { authStub } from "#/test-support/auth-stub";

const useAuth = vi.hoisted(() => vi.fn());
vi.mock("#/features/auth/api/use-auth", () => ({ useAuth }));

vi.mock("#/features/settings/api/use-update-setting", () => ({
  useUpdateSetting: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("#/features/settings/components/setting-history-dialog", () => ({
  SettingHistoryDialog: () => null,
}));

const meta = { updatedAtMs: null, updatedByName: null };
const noticeOnly: SiteSettingsSnapshot = {
  "notice.enabled": { value: false, ...meta },
  "notice.text": { value: "", ...meta },
  "notice.tone": { value: "info", ...meta },
  "notice.audience": { value: "members", ...meta },
};

function renderCategories(permissions: string[]) {
  useAuth.mockReturnValue(authStub(permissions));
  return render(
    <TooltipProvider>
      <SettingsCategories entries={noticeOnly} />
    </TooltipProvider>,
  );
}

describe("SettingsCategories", () => {
  it("shows a notice:manage-only officer the Notice section alone", () => {
    renderCategories(["notice:manage"]);

    expect(screen.getByRole("heading", { name: "Notice" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Contact" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Pages/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Features" })).toBeNull();
  });

  it("shows a settings manager without notice:manage no Notice section", () => {
    renderCategories(["settings:manage"]);

    expect(screen.queryByRole("heading", { name: "Notice" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Contact" })).toBeVisible();
  });

  it("shows every category to someone holding both", () => {
    renderCategories(["settings:manage", "notice:manage"]);

    for (const name of ["Notice", "Contact", "Features", "Appearance"]) {
      expect(screen.getByRole("heading", { name })).toBeVisible();
    }
  });
});
