import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GearModelsManageDialog } from "#/features/gear/components/gear-models-manage-dialog";
import type { GearModelSummaryDto } from "#/features/gear/server/gear-fns";

// ── module mocks ────────────────────────────────────────────────────────

vi.mock("#/features/gear/api/queries", () => {
  // Built inside the factory: `vi.mock` is hoisted above every top-level
  // binding in this file, so a fixture declared outside is still in its
  // temporal dead zone when the factory runs.
  const countedModel = {
    publicId: "model_counted",
    name: "HotWire Draw",
    manufacturer: "Black Diamond",
    tracking: "counted",
    description: null,
    msrpCents: null,
    serviceLifeYears: null,
    inspectionIntervalDays: null,
    effectiveInspectionIntervalDays: null,
    imageKey: null,
    productUrl: null,
    type: { publicId: "type_1", name: "Quickdraw", prefix: "QD" },
    stock: [
      { condition: "serviceable", quantity: 38 },
      { condition: "needs_repair", quantity: 4 },
    ],
    onLoan: 6,
    onHold: 0,
    attributes: [],
  } satisfies GearModelSummaryDto;
  const codedModel = {
    ...countedModel,
    publicId: "model_coded",
    name: "Corax",
    manufacturer: "Petzl",
    tracking: "coded",
    stock: [],
    onLoan: 0,
  } satisfies GearModelSummaryDto;
  const stub = (data: unknown) => () => ({
    queryKey: ["stub", JSON.stringify(data)],
    queryFn: async () => data,
  });
  return {
    gearTypesQueryOptions: stub([
      { publicId: "type_1", name: "Quickdraw", prefix: "QD" },
    ]),
    gearModelsQueryOptions: stub([countedModel, codedModel]),
    gearAttributeDefsQueryOptions: stub([]),
  };
});

const setStock = vi.fn();
vi.mock("#/features/gear/api/use-set-gear-model-stock", () => ({
  useSetGearModelStock: () => ({ mutate: setStock, isPending: false }),
}));
vi.mock("#/features/gear/api/use-create-gear-model", () => ({
  useCreateGearModel: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("#/features/gear/api/use-update-gear-model", () => ({
  useUpdateGearModel: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("#/features/gear/api/use-delete-gear-model", () => ({
  useDeleteGearModel: () => ({ mutate: vi.fn(), isPending: false }),
}));

// ── helpers ─────────────────────────────────────────────────────────────

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GearModelsManageDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

async function openStockPane(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Stock for HotWire Draw" }),
  );
}

// ── tests ───────────────────────────────────────────────────────────────

describe("GearModelsManageDialog stock editor", () => {
  it("offers the stock editor only for counted models", async () => {
    renderDialog();

    // A coded model counts its item rows, so a quantity box would be a
    // second, disagreeing answer to "how many are there".
    expect(
      await screen.findByRole("button", { name: "Stock for HotWire Draw" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Stock for Corax" }),
    ).not.toBeInTheDocument();
  });

  it("nets out what is on loan, because stock counts it", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openStockPane(user);

    // 38 serviceable with 6 out is 32 on the shelf. Showing only the
    // first number reads as a shelf count and makes the save refusal
    // below it look arbitrary.
    const takeable = screen.getByText("Takeable now").closest("div");
    expect(within(takeable as HTMLElement).getByText("32")).toBeInTheDocument();
    expect(screen.getByLabelText("Serviceable")).toHaveValue(38);
    expect(screen.getByLabelText("Needs repair")).toHaveValue(4);
  });

  it("sends every bucket, so a box cleared to zero is saved as zero", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openStockPane(user);

    await user.clear(screen.getByLabelText("Needs repair"));
    await user.type(screen.getByLabelText("Needs repair"), "0");
    await user.click(screen.getByRole("button", { name: "Save stock" }));

    expect(setStock).toHaveBeenCalledWith(
      {
        publicId: "model_counted",
        stock: [
          { condition: "serviceable", quantity: 38 },
          { condition: "needs_repair", quantity: 0 },
          { condition: "unsafe", quantity: 0 },
        ],
      },
      expect.anything(),
    );
  });
});
