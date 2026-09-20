import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GearBatchInspectionsDialog } from "#/features/gear/components/gear-batch-inspections-dialog";

// ── module mocks ────────────────────────────────────────────────────────

vi.mock("#/features/gear/api/queries", () => {
  // Inside the factory: `vi.mock` hoists above every top-level binding.
  const stub = (data: unknown) => () => ({
    queryKey: ["stub", JSON.stringify(data)],
    queryFn: async () => data,
  });
  return {
    countedModelsForInspectionQueryOptions: stub([
      {
        publicId: "model_slings",
        name: "Nylon Sling 120cm",
        manufacturer: null,
        typeName: "Sling",
        effectiveInspectionIntervalDays: 365,
        lastInspectedAtMs: null,
        serviceLifeYears: 10,
        manufacturedAtMs: Date.parse("2010-06-01T00:00:00Z"),
      },
      {
        publicId: "model_draws",
        name: "HotWire Draw",
        manufacturer: "Black Diamond",
        typeName: "Quickdraw",
        effectiveInspectionIntervalDays: null,
        lastInspectedAtMs: Date.parse("2026-08-01T12:00:00Z"),
        serviceLifeYears: null,
        manufacturedAtMs: null,
      },
    ]),
    gearModelInspectionsQueryOptions: stub([
      {
        publicId: "gi_1",
        inspectedAt: Temporal.Instant.fromEpochMilliseconds(
          Date.parse("2026-08-01T12:00:00Z"),
        ),
        result: "pass",
        notes: "All twelve fine.",
        inspectorName: "Ivy Inspector",
        createdAt: Temporal.Instant.fromEpochMilliseconds(
          Date.parse("2026-08-01T12:00:00Z"),
        ),
      },
    ]),
  };
});

// ── helpers ─────────────────────────────────────────────────────────────

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GearBatchInspectionsDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

// ── tests ───────────────────────────────────────────────────────────────

describe("GearBatchInspectionsDialog", () => {
  it("shows each bin's clocks and when it was last looked at", async () => {
    renderDialog();

    expect(await screen.findByText("Nylon Sling 120cm")).toBeInTheDocument();
    expect(screen.getByText(/Sling · never inspected/)).toBeInTheDocument();
    // Ten-year slings made in 2010, never checked: both clocks flag.
    expect(screen.getByText("Past service life")).toBeInTheDocument();
    expect(screen.getByText("Never inspected")).toBeInTheDocument();
    // The draws have no cadence and no stated life, so they stay quiet
    // rather than wearing "no inspection cadence" as a badge.
    expect(screen.getByText(/Quickdraw · last checked/)).toBeInTheDocument();
  });

  it("opens one bin's batch log, the only write it offers", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(
      (await screen.findAllByRole("button", { name: "Open" }))[0],
    );

    expect(screen.getByText("All twelve fine.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Log inspection/ }),
    ).toBeInTheDocument();
    // No catalog affordances: this is a worklist, not the model editor.
    expect(
      screen.queryByRole("button", { name: /Delete/ }),
    ).not.toBeInTheDocument();
  });
});
