import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GearFormSheet } from "#/features/gear/components/gear-form-sheet";
import type * as AttributeFieldsModule from "#/features/gear/components/gear-attribute-fields";
import type { GearDetail, GearSummary } from "#/features/gear/server/gear-fns";

// ── module mocks ────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const editMutateMock = vi.hoisted(() => vi.fn());
const createMutateMock = vi.hoisted(() => vi.fn());
vi.mock("#/features/gear/api/use-edit-gear", () => ({
  useEditGear: () => ({ mutate: editMutateMock, isPending: false }),
}));
vi.mock("#/features/gear/api/use-create-gear", () => ({
  useCreateGear: () => ({ mutate: createMutateMock, isPending: false }),
}));
vi.mock("#/features/gear/api/use-create-gear-model", () => ({
  useCreateGearModel: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("#/features/gear/api/queries", () => {
  const stub = (data: unknown) => () => ({
    queryKey: ["stub", JSON.stringify(data)],
    queryFn: async () => data,
  });
  return {
    gearTypesQueryOptions: stub([
      { publicId: "type_1", name: "Harness", prefix: "CH" },
    ]),
    gearModelsQueryOptions: stub([
      {
        publicId: "model_1",
        name: "Corax",
        manufacturer: "Petzl",
        tracking: "coded",
        type: { publicId: "type_1", name: "Harness", prefix: "CH" },
      },
    ]),
    gearTagsQueryOptions: stub([]),
    gearSuggestedCodeQueryOptions: stub({ suggestion: null }),
  };
});

// The attribute controls are covered in their own suite; what matters
// here is only whether the sheet puts an `attributes` key on the wire.
vi.mock("#/features/gear/components/gear-attribute-fields", async (orig) => ({
  ...(await orig<typeof AttributeFieldsModule>()),
  GearAttributeFields: () => <div data-testid="attribute-fields" />,
}));
vi.mock("#/features/gear/components/gear-tag-multiselect", () => ({
  GearTagMultiselect: () => <div data-testid="tag-multiselect" />,
}));

// ── fixtures ────────────────────────────────────────────────────────────

const summary: GearSummary = {
  publicId: "gear_1",
  code: "CH1",
  thumbnailKey: null,
  status: "active",
  condition: "serviceable",
  whereabouts: "cave",
  whereaboutsAsOf: null,
  whereaboutsNote: null,
  manufacturedAt: null,
  acquiredAt: null,
  acquisitionCostCents: null,
  acquisitionKind: null,
  deactivatedAt: null,
  deactivatedReason: null,
  createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
  updatedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
  model: {
    publicId: "model_1",
    name: "Corax",
    manufacturer: "Petzl",
    tracking: "coded",
    msrpCents: null,
    serviceLifeYears: null,
    imageKey: null,
    productUrl: null,
  },
  type: { publicId: "type_1", name: "Harness", prefix: "CH" },
  tags: [],
  availability: "available",
  availableFrom: null,
  isMine: false,
  holdReason: null,
  holdEndsAt: null,
  inspection: { status: "untracked", dueAt: null, lastInspectedAt: null },
  serviceLife: { status: "untracked", expiresAt: null },
} as unknown as GearSummary;

const detail: GearDetail = {
  ...summary,
  notesMarkdown: null,
  attributes: [],
  serialNumber: "SN-9",
  currentLoan: null,
};

function renderSheet(gear: GearSummary | GearDetail) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GearFormSheet
        open
        onOpenChange={() => {}}
        intent={{ mode: "edit", gear }}
      />
    </QueryClientProvider>,
  );
}

async function save() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Save changes" }),
  );
}

beforeEach(() => {
  editMutateMock.mockReset();
  createMutateMock.mockReset();
});

// ── tests ───────────────────────────────────────────────────────────────

describe("GearFormSheet edit payload", () => {
  it("omits attributes when opened from a summary", async () => {
    // The list page hands over a GearSummary, which never carried the
    // answers. Sending `attributes: []` would read as "clear them all"
    // — and the moment the type has a required item-level definition,
    // the save is refused outright and the officer can't edit at all.
    renderSheet(summary);
    await save();

    await waitFor(() => expect(editMutateMock).toHaveBeenCalled());
    expect(editMutateMock.mock.calls[0]?.[0]).not.toHaveProperty("attributes");
    expect(screen.queryByTestId("attribute-fields")).not.toBeInTheDocument();
  });

  it("sends attributes when opened from a detail payload", async () => {
    renderSheet(detail);
    await save();

    await waitFor(() => expect(editMutateMock).toHaveBeenCalled());
    expect(editMutateMock.mock.calls[0]?.[0]).toHaveProperty("attributes", []);
    expect(screen.getByTestId("attribute-fields")).toBeInTheDocument();
  });
});
