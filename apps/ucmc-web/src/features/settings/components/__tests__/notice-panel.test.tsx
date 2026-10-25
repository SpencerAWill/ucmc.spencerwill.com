/**
 * The Notice section of /settings: the four rows plus a preview of the
 * bar exactly as it will render, so an officer sees the tone and the
 * ticker before switching it on.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "#/components/ui/tooltip";
import { NoticePanel } from "#/features/settings/components/notice-panel";
import type { SiteSettingsSnapshot } from "#/features/settings/server/settings-fns";

vi.mock("#/features/settings/api/use-update-setting", () => ({
  useUpdateSetting: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("#/features/settings/components/setting-history-dialog", () => ({
  SettingHistoryDialog: () => null,
}));

function snapshot(enabled: boolean): SiteSettingsSnapshot {
  const meta = { updatedAtMs: null, updatedByName: null };
  return {
    "notice.enabled": { value: enabled, ...meta },
    "notice.text": { value: "Gear due Friday", ...meta },
    "notice.tone": { value: "warning", ...meta },
    "notice.audience": { value: "members", ...meta },
  };
}

function renderPanel(entries: SiteSettingsSnapshot | undefined) {
  return render(
    <TooltipProvider>
      <NoticePanel entries={entries} />
    </TooltipProvider>,
  );
}

const preview = () =>
  screen.getByRole("complementary", { name: "Site notice" });

describe("NoticePanel", () => {
  it("previews the bar and says it isn't live while switched off", () => {
    renderPanel(snapshot(false));

    expect(screen.getByRole("heading", { name: "Notice" })).toBeVisible();
    expect(preview()).toHaveTextContent("Gear due Friday");
    expect(preview()).toHaveClass("bg-notice-warning");
    expect(screen.getByText("Preview (not live)")).toBeVisible();
    expect(screen.getByText("Visible to: approved members")).toBeVisible();
  });

  it("says Live once it is switched on", () => {
    renderPanel(snapshot(true));

    expect(screen.queryByText("Preview (not live)")).toBeNull();
    expect(screen.getByText("Live")).toBeVisible();
  });

  it("renders all four settings", () => {
    renderPanel(snapshot(false));

    for (const label of ["Show notice", "Notice text", "Audience", "Tone"]) {
      expect(screen.getByText(label, { selector: "label" })).toBeVisible();
    }
  });

  it("draws each tone's swatch in its picker", async () => {
    const user = userEvent.setup();
    renderPanel(snapshot(false));

    await user.click(screen.getByRole("combobox", { name: "Tone" }));
    for (const [name, tone] of [
      ["Info", "info"],
      ["Success", "success"],
      ["Warning", "warning"],
      ["Danger", "danger"],
      ["Neutral", "neutral"],
    ] as const) {
      const option = screen.getByRole("option", { name });
      expect(within(option).getByTestId(`tone-swatch-${tone}`)).toHaveClass(
        `bg-notice-${tone}`,
      );
    }
  });

  it("shows no preview when there is no text to preview", () => {
    const entries = snapshot(false);
    renderPanel({
      ...entries,
      "notice.text": { value: "", updatedAtMs: null, updatedByName: null },
    });

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByText(/Add notice text to see a preview/)).toBeVisible();
  });
});
