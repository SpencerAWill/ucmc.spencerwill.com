import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { LoansToolbar } from "#/features/gear/components/loans-toolbar";
import type { LoansToolbarState } from "#/features/gear/components/loans-toolbar";

// ── module mocks ────────────────────────────────────────────────────────

// The combobox runs its own member-search query; this suite is about
// the toolbar's chips and tab coupling, not the picker.
vi.mock("#/features/gear/components/member-search-combobox", () => ({
  MemberSearchCombobox: () => <div data-testid="member-combobox" />,
}));

// ── helpers ─────────────────────────────────────────────────────────────

/** Both chip-raising dimensions set away from their defaults. */
const filteredState: LoansToolbarState = {
  tab: "active",
  q: "",
  overdueOnly: true,
  sort: "due_at",
  dir: "asc",
  selectedMember: {
    userId: "user_1",
    publicId: "pub_1",
    fullName: "Avery Belay",
    primaryEmail: "avery@example.com",
  },
};

function renderToolbar(initial: LoansToolbarState = filteredState) {
  function Harness() {
    const [state, setState] = useState<LoansToolbarState>(initial);
    return (
      <LoansToolbar
        state={state}
        onChange={(next) => setState((prev) => ({ ...prev, ...next }))}
      />
    );
  }
  return render(<Harness />);
}

/** Chip labels, with the button's `sr-only` prefix stripped — the
 *  accessible name is "Remove filter: Avery Belay", the chip reads
 *  "Avery Belay". */
const chipNames = () =>
  screen
    .queryAllByRole("button", { name: /^Remove filter:/ })
    .map((b) => b.textContent.replace(/^Remove filter:\s*/, ""));

// ── tests ───────────────────────────────────────────────────────────────

describe("LoansToolbar chips", () => {
  it("raises one per narrowed dimension", () => {
    renderToolbar();
    expect(chipNames()).toEqual(
      expect.arrayContaining(["Avery Belay", "Overdue only"]),
    );
  });

  it("clear all leaves none behind", async () => {
    renderToolbar();
    // Sanity: the fixture really is filtered, so the assertion below
    // can't pass by rendering nothing at all.
    expect(chipNames().length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(chipNames()).toHaveLength(0);
  });

  it("drops the overdue chip when switching to history", async () => {
    renderToolbar();
    expect(chipNames()).toContain("Overdue only");

    await userEvent.click(screen.getByRole("tab", { name: "History" }));

    // "Overdue only" has no meaning on returned loans and its checkbox
    // is hidden there, so the chip has to go with it — otherwise the
    // tab switch strands a chip with no control behind it, and the
    // filter count claims a narrowing the user can't see or undo.
    expect(chipNames()).not.toContain("Overdue only");
    expect(chipNames()).toContain("Avery Belay");
  });
});
