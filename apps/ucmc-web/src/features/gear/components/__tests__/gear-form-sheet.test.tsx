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

// Per-test suggestion, so the auto-fill path is reachable. It was
// hardcoded to `null`, which meant every test here ran with the effect
// short-circuited and the code field behaving like a plain input.
const suggestionMock = vi.hoisted(() => ({ value: null as string | null }));

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
    gearSuggestedCodeQueryOptions: (typePublicId: string | null) => ({
      // Keyed by type, matching the real factory — the component relies
      // on the suggestion changing when the type does. The null branch
      // mirrors it too: with no type picked the real one is `enabled:
      // false` and answers an empty suggestion, so a stub that handed
      // one over regardless would auto-fill the field before a type was
      // ever selected and make these tests assert the wrong thing.
      queryKey: ["stub", "suggestedCode", typePublicId],
      queryFn: async () => ({
        suggestion: typePublicId === null ? "" : suggestionMock.value,
      }),
    }),
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

function renderCreate() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GearFormSheet open onOpenChange={() => {}} intent={{ mode: "create" }} />
    </QueryClientProvider>,
  );
}

/** Pick the only type the queries stub offers, which is what arms the
 *  suggested-code query. */
async function selectHarnessType() {
  await userEvent.click(await screen.findByRole("combobox", { name: "Type" }));
  await userEvent.click(await screen.findByRole("option", { name: /Harness/ }));
}

beforeEach(() => {
  editMutateMock.mockReset();
  createMutateMock.mockReset();
  suggestionMock.value = null;
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

describe("GearFormSheet suggested code", () => {
  it("fills an empty code field once the type's suggestion arrives", async () => {
    suggestionMock.value = "CH4";
    renderCreate();
    await selectHarnessType();

    await waitFor(() =>
      expect(screen.getByLabelText("Code")).toHaveValue("CH4"),
    );
  });

  it("lets the officer clear the code after a type is selected", async () => {
    // The regression: with `code` in the effect's deps, clearing the
    // field re-entered the effect with its emptiness guard now satisfied
    // and the suggestion went straight back in. "Blank for unlabeled" —
    // which the hint under the input promises, and which the submit path
    // maps to `code: null` — was unreachable once a type was picked.
    suggestionMock.value = "CH4";
    renderCreate();
    await selectHarnessType();

    const codeInput = await screen.findByLabelText("Code");
    await waitFor(() => expect(codeInput).toHaveValue("CH4"));
    await userEvent.clear(codeInput);

    expect(codeInput).toHaveValue("");
    // A re-fill lands in a later effect pass, so settle before asserting
    // the field is still empty rather than catching it mid-flight.
    await waitFor(() => expect(codeInput).toHaveValue(""));
  });

  it("submits a cleared code as null", async () => {
    suggestionMock.value = "CH4";
    renderCreate();
    await selectHarnessType();

    const codeInput = await screen.findByLabelText("Code");
    await waitFor(() => expect(codeInput).toHaveValue("CH4"));
    await userEvent.clear(codeInput);
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Model" }),
    );
    await userEvent.click(await screen.findByRole("option", { name: /Corax/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add gear" }));

    await waitFor(() => expect(createMutateMock).toHaveBeenCalled());
    expect(createMutateMock.mock.calls[0][0]).toMatchObject({ code: null });
  });

  it("does not clobber a code typed before the suggestion resolves", async () => {
    // The emptiness check moved inside the state updater; if it read a
    // stale closure instead, this hand-typed value would be overwritten.
    suggestionMock.value = "CH4";
    renderCreate();
    const codeInput = await screen.findByLabelText("Code");
    await userEvent.type(codeInput, "RESCUE-1");
    await selectHarnessType();

    await waitFor(() => expect(codeInput).toHaveValue("RESCUE-1"));
  });
});
