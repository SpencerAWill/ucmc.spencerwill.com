import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { GearToolbar } from "#/features/gear/components/gear-toolbar";
import type { GearToolbarState } from "#/features/gear/components/gear-toolbar";

// ── module mocks ────────────────────────────────────────────────────────

vi.mock("#/features/gear/api/queries", () => {
  const stub = (data: unknown) => () => ({
    queryKey: ["stub", JSON.stringify(data)],
    queryFn: async () => data,
  });
  return {
    gearTypesQueryOptions: stub([
      { publicId: "type_1", name: "Harness", prefix: "CH" },
    ]),
    gearTagsQueryOptions: stub([
      { publicId: "tag_1", name: "dry-treated", visibility: "public" },
    ]),
    gearAttributeDefsQueryOptions: stub([]),
    gearModelBrowseQueryOptions: stub([
      { publicId: "model_1", name: "Corax", manufacturer: "Petzl" },
    ]),
  };
});
vi.mock("#/features/gear/components/gear-tag-multiselect", () => ({
  GearTagMultiselect: () => <div data-testid="tag-multiselect" />,
}));

// ── helpers ─────────────────────────────────────────────────────────────

/** Every dimension that raises a chip, all set away from its default. */
const filteredState: GearToolbarState = {
  typePublicId: "type_1",
  modelPublicId: "model_1",
  attributes: {},
  tagPublicIds: ["tag_1"],
  status: "retired",
  availability: "on_loan",
  condition: "needs_repair",
  whereabouts: "missing",
  inspection: "overdue",
  serviceLife: "expired",
  q: "",
  sort: "code",
  dir: "asc",
  view: "list",
};

function renderToolbar() {
  function Harness() {
    const [state, setState] = useState<GearToolbarState>(filteredState);
    return (
      <GearToolbar
        state={state}
        onChange={(next) => setState((prev) => ({ ...prev, ...next }))}
      />
    );
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

// ── tests ───────────────────────────────────────────────────────────────

describe("GearToolbar clear all", () => {
  it("leaves no filter chip behind", async () => {
    renderToolbar();
    // Sanity: the fixture really is filtered, so an empty assertion
    // below can't pass by rendering nothing at all.
    expect(
      screen.getAllByRole("button", { name: /^Remove filter:/ }).length,
    ).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));

    // A dimension missing from `clearFilters` shows up here as a chip
    // that survived its own clear button — `availability` did exactly
    // that, leaving the list filtered with the counter stuck at 1.
    expect(
      screen.queryAllByRole("button", { name: /^Remove filter:/ }),
    ).toHaveLength(0);
  });
});
