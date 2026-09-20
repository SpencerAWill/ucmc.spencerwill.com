import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GearAttributeFields,
  attributeInputsFrom,
} from "#/features/gear/components/gear-attribute-fields";
import type { AttributeFormValues } from "#/features/gear/components/gear-attribute-fields";
import type { GearAttributeDefSummary } from "#/features/gear/lib/attributes";

// ── module mocks ────────────────────────────────────────────────────────

const defsMock = vi.hoisted<{ current: GearAttributeDefSummary[] }>(() => ({
  current: [],
}));

vi.mock("#/features/gear/api/queries", () => ({
  gearAttributeDefsQueryOptions: () => ({
    queryKey: ["gear", "attributeDefs", "stub"],
    queryFn: async () => defsMock.current,
  }),
}));

// ── helpers ─────────────────────────────────────────────────────────────

function def(
  over: Partial<GearAttributeDefSummary> & { publicId: string; label: string },
): GearAttributeDefSummary {
  return {
    key: over.publicId,
    kind: "text",
    level: "item",
    options: null,
    unit: null,
    required: false,
    position: 0,
    archived: false,
    typePublicIds: ["type_1"],
    ...over,
  };
}

/** Mounts the block with real state, and renders the wire payload the
 *  submit path would send so a test can read it directly. */
function renderFields() {
  function Harness() {
    const [values, setValues] = useState<AttributeFormValues>({});
    return (
      <>
        <GearAttributeFields
          typePublicId="type_1"
          level="item"
          values={values}
          onChange={setValues}
          idPrefix="test"
        />
        <output data-testid="wire">
          {JSON.stringify(attributeInputsFrom(values))}
        </output>
      </>
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

function wire(): Array<{ defPublicId: string; value: string | null }> {
  return JSON.parse(screen.getByTestId("wire").textContent);
}

beforeEach(() => {
  defsMock.current = [];
});

// ── tests ───────────────────────────────────────────────────────────────

describe("GearAttributeFields boolean seeding", () => {
  it("sends an untouched required switch as an explicit No", async () => {
    defsMock.current = [
      def({
        publicId: "d_dry",
        label: "Dry treated",
        kind: "boolean",
        required: true,
      }),
    ];
    renderFields();

    // The switch renders off from the moment it mounts, so "No" is the
    // answer the officer is looking at — and the one the server has to
    // receive, or a required boolean can only be answered by toggling
    // on and back off again.
    await waitFor(() =>
      expect(wire()).toEqual([{ defPublicId: "d_dry", value: "false" }]),
    );
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("carries a toggled switch through as true", async () => {
    defsMock.current = [
      def({ publicId: "d_dry", label: "Dry treated", kind: "boolean" }),
    ];
    renderFields();
    await waitFor(() => expect(screen.getByRole("switch")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("switch"));

    expect(wire()).toEqual([{ defPublicId: "d_dry", value: "true" }]);
  });

  it("leaves every other kind genuinely blank", async () => {
    defsMock.current = [
      def({ publicId: "d_note", label: "Note", kind: "text" }),
      def({
        publicId: "d_size",
        label: "Size",
        kind: "select",
        options: ["S", "M"],
      }),
      def({ publicId: "d_len", label: "Length", kind: "number", unit: "m" }),
    ];
    renderFields();
    await waitFor(() =>
      expect(screen.getByLabelText("Note")).toBeInTheDocument(),
    );

    // A blank text box is unanswered, not "". Only the switch has no
    // unanswered position.
    expect(wire()).toEqual([]);
  });
});
