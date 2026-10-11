import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelBinLabelPane } from "#/features/gear/components/model-bin-label-pane";
import { parseScanPayload } from "#/features/gear/lib/scan-payload";

// The real barcode is an SVG drawn by JsBarcode; what matters here is
// the value and the symbology handed to it.
vi.mock("#/features/gear/components/gear-barcode", () => ({
  GearBarcode: ({ value, format }: { value: string; format: string }) => (
    <span data-testid="barcode" data-format={format}>
      {value}
    </span>
  ),
}));

const model = {
  publicId: "k3v9x0p2m1aa",
  name: "BD HotForge 12cm",
  typeName: "Quickdraw",
};

describe("ModelBinLabelPane", () => {
  it("encodes a payload the desk parses back to this model, in CODE128", () => {
    render(<ModelBinLabelPane model={model} onDone={() => {}} />);

    const barcode = screen.getByTestId("barcode");
    expect(barcode).toHaveAttribute("data-format", "CODE128");
    // The round trip is the contract: whatever the printer encodes, the
    // desk's one discriminator must read as this model.
    expect(parseScanPayload(barcode.textContent)).toEqual({
      kind: "model",
      modelPublicId: "k3v9x0p2m1aa",
      symbology: null,
    });
  });

  it("prints one copy per bin", async () => {
    render(<ModelBinLabelPane model={model} onDone={() => {}} />);

    const copies = screen.getByLabelText("Copies");
    await userEvent.clear(copies);
    await userEvent.type(copies, "3");

    expect(screen.getAllByTestId("barcode")).toHaveLength(3);
  });
});
