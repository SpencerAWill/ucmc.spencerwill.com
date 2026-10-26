/**
 * The click-to-edit lifecycle on a text setting row.
 *
 * `/settings` is forty-odd rows deep, so the row is a value with a
 * pencil at rest rather than a permanently-mounted input and Save
 * button. The part worth pinning is *when the editor closes*: closing on
 * submit is the obvious implementation and it silently discards what the
 * admin typed the moment the registry's schema rejects it, because the
 * row behind the editor renders the canonical value.
 *
 * `useUpdateSetting` is the only thing mocked, so `useSettingSaver`'s
 * real outcome plumbing — including the `SaveOutcome` this row branches
 * on — is under test rather than stubbed out.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "#/components/ui/tooltip";
import { SettingRow } from "#/features/settings/components/setting-row";
import type { SiteSettingEntry } from "#/features/settings/server/settings-fns";

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock("#/features/settings/api/use-update-setting", () => ({
  useUpdateSetting: () => ({ mutateAsync, isPending: false }),
}));

// The history dialog fetches its own audit rows and is not what this
// suite is about; the footer button that opens it stays real.
vi.mock("#/features/settings/components/setting-history-dialog", () => ({
  SettingHistoryDialog: () => null,
}));

const KEY = "contact.clubEmail" as const;

function entry(value: string): SiteSettingEntry<typeof KEY> {
  return { value, updatedAtMs: null, updatedByName: null };
}

/**
 * `TooltipProvider` lives in the app shell, so a row rendered on its own
 * has to supply one — the pencil and the footer buttons are all
 * `TooltipTrigger`s and Radix throws without a provider in scope.
 */
function renderRow(value = "club@example.com") {
  return render(
    <TooltipProvider>
      <SettingRow settingKey={KEY} entry={entry(value)} />
    </TooltipProvider>,
  );
}

const editButton = () =>
  screen.getByRole("button", { name: /Edit Club email/ });
const saveButton = () =>
  screen.getByRole("button", { name: /Save Club email/ });

describe("SettingRow (text setting)", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it("shows the value and no input until the pencil is clicked", () => {
    // The whole point of the pattern: forty rows, no resting editors.
    renderRow();

    expect(screen.getByText("club@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(editButton()).toBeInTheDocument();
  });

  it("renders a placeholder rather than an empty line when unset", () => {
    renderRow("");

    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("closes the editor and saves the new value", async () => {
    mutateAsync.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderRow();

    await user.click(editButton());
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "new@example.com");
    await user.click(saveButton());

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(mutateAsync).toHaveBeenCalledWith({
      key: KEY,
      value: "new@example.com",
    });
  });

  it("keeps the editor open and the typed value intact when the save is rejected", async () => {
    // The regression this test exists for. A schema rejection is exactly
    // when the admin needs their text still on screen to fix it, and the
    // row behind the editor shows the canonical value — so closing here
    // throws the edit away and looks like the row ignored them.
    mutateAsync.mockResolvedValue({ ok: false, reason: "invalid_value" });
    const user = userEvent.setup();
    renderRow();

    await user.click(editButton());
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "not-an-email");
    await user.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText(/failed validation/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox")).toHaveValue("not-an-email");
  });

  it("surfaces a transport failure instead of swallowing it", async () => {
    // `mutateAsync` rejects on a dropped connection. Every caller reached
    // `persist` through a `void`, so this used to be an unhandled
    // rejection and nothing on screen — the row just looked dead.
    mutateAsync.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    renderRow();

    await user.click(editButton());
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "other@example.com");
    await user.click(saveButton());

    await waitFor(() =>
      expect(
        screen.getByText(/couldn’t reach the server/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("reverts the draft on cancel and doesn't resurrect it", async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(editButton());
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "abandoned@example.com");
    await user.click(
      screen.getByRole("button", { name: /Cancel editing Club email/ }),
    );

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("club@example.com")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();

    await user.click(editButton());
    expect(screen.getByRole("textbox")).toHaveValue("club@example.com");
  });

  it("saves on Enter and cancels on Escape", async () => {
    // The input isn't inside a <form>, so Enter would otherwise do
    // nothing at all. Same contract as the passkey rename editor.
    mutateAsync.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderRow();

    await user.click(editButton());
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "enter@example.com{Enter}");

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(mutateAsync).toHaveBeenCalledWith({
      key: KEY,
      value: "enter@example.com",
    });

    await user.click(editButton());
    await user.type(screen.getByRole("textbox"), "x{Escape}");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps reset and history reachable while editing", async () => {
    // They are the row's trailing cluster in both states on purpose:
    // only the leading part swaps, so the flexible element absorbs the
    // width change and these two don't relocate when editing starts.
    // jsdom can't measure that, but it can pin that they never
    // unmount — which is the half a refactor is likely to break by
    // moving them back into a state-specific branch.
    const user = userEvent.setup();
    renderRow();

    const reachable = () => [
      screen.queryByRole("button", { name: "Edit history" }),
      screen.queryByRole("button", { name: "Reset to default" }),
    ];

    // `contact.clubEmail` here is customized (its seeded value differs
    // from the registry default), so both buttons are present.
    expect(reachable().every(Boolean)).toBe(true);

    await user.click(editButton());

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(reachable().every(Boolean)).toBe(true);
  });

  it("refuses an unchanged save", async () => {
    // Every write is an audit event, so a no-op save would append a row
    // recording that nothing happened.
    const user = userEvent.setup();
    renderRow();

    await user.click(editButton());

    expect(saveButton()).toBeDisabled();
  });
});

describe("SettingRow (enum setting)", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  function renderEnumRow<TKey extends "notice.tone" | "notice.audience">(
    settingKey: TKey,
    value: SiteSettingEntry<TKey>["value"],
  ) {
    return render(
      <TooltipProvider>
        <SettingRow
          settingKey={settingKey}
          entry={{ value, updatedAtMs: null, updatedByName: null }}
        />
      </TooltipProvider>,
    );
  }

  it("renders a picker rather than a pencil", () => {
    renderEnumRow("notice.tone", "info");

    expect(screen.getByRole("combobox", { name: "Tone" })).toHaveTextContent(
      "Info",
    );
    expect(screen.queryByRole("button", { name: /Edit Tone/ })).toBeNull();
  });

  it("applies a choice immediately, with no tick to confirm", async () => {
    mutateAsync.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderEnumRow("notice.tone", "warning");

    expect(
      screen.getByRole("button", { name: "Reset to default" }),
    ).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Tone" }));
    await user.click(screen.getByRole("option", { name: "Danger" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      key: "notice.tone",
      value: "danger",
    });
    expect(screen.queryByRole("button", { name: /Save Tone/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reset to default" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit history" })).toBeVisible();
  });

  it("shows the new pick while it saves, not the old one", async () => {
    // A controlled Select bound to the saved value snaps back to the old
    // option for the whole round trip, which reads as the pick refused.
    mutateAsync.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderEnumRow("notice.tone", "warning");

    await user.click(screen.getByRole("combobox", { name: "Tone" }));
    await user.click(screen.getByRole("option", { name: "Danger" }));

    expect(screen.getByRole("combobox", { name: "Tone" })).toHaveTextContent(
      "Danger",
    );
  });

  it("puts the saved value back when the write fails", async () => {
    mutateAsync.mockResolvedValue({ ok: false, reason: "invalid_value" });
    const user = userEvent.setup();
    renderEnumRow("notice.tone", "warning");

    await user.click(screen.getByRole("combobox", { name: "Tone" }));
    await user.click(screen.getByRole("option", { name: "Danger" }));

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Tone" })).toHaveTextContent(
        "Warning",
      ),
    );
  });

  it("labels options from the registry, not the raw value", async () => {
    const user = userEvent.setup();
    renderEnumRow("notice.audience", "members");

    expect(
      screen.getByRole("combobox", { name: "Audience" }),
    ).toHaveTextContent("Approved members");
    await user.click(screen.getByRole("combobox", { name: "Audience" }));
    expect(screen.getByRole("option", { name: "Everyone" })).toBeVisible();
  });
});
