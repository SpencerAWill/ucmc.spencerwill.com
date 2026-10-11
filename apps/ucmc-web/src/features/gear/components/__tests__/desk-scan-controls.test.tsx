import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "#/components/ui/tooltip";
import { DeskScanControls } from "#/features/gear/components/desk-scan-controls";

// The viewfinder needs a camera stack jsdom doesn't have. The stub
// renders the overlay the real one floats over its corner, and reports
// whether it was told to run.
const scannerProps = vi.hoisted<{
  current: { onEnabledChange: (next: boolean) => void } | null;
}>(() => ({ current: null }));
vi.mock("#/features/gear/components/barcode-scanner", () => ({
  BarcodeScanner: (props: {
    enabled: boolean;
    onEnabledChange: (next: boolean) => void;
    overlayLeft?: ReactNode;
    overlayRight?: ReactNode;
  }) => {
    scannerProps.current = props;
    return (
      <div data-testid="viewfinder" data-enabled={String(props.enabled)}>
        <div data-testid="corner-left">{props.overlayLeft}</div>
        <div data-testid="corner-right">{props.overlayRight}</div>
      </div>
    );
  },
}));

function renderControls() {
  return render(
    <TooltipProvider>
      <DeskScanControls onScan={() => {}} />
    </TooltipProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  scannerProps.current = null;
});

describe("DeskScanControls overlay toggles", () => {
  it("floats camera top-left and handheld top-right — camera off, handheld on by default", () => {
    renderControls();

    const camera = screen.getByRole("button", { name: "Camera" });
    const handheld = screen.getByRole("button", { name: "Handheld scanner" });
    expect(screen.getByTestId("corner-left")).toContainElement(camera);
    expect(screen.getByTestId("corner-right")).toContainElement(handheld);
    expect(camera).toHaveAttribute("aria-pressed", "false");
    expect(handheld).toHaveAttribute("aria-pressed", "true");
  });

  it("drives the viewfinder from the camera toggle and remembers the choice", async () => {
    renderControls();

    await userEvent.click(screen.getByRole("button", { name: "Camera" }));

    expect(screen.getByTestId("viewfinder")).toHaveAttribute(
      "data-enabled",
      "true",
    );
    // The key predates the rename, so saved choices survive it.
    expect(window.localStorage.getItem("ucmc:gear-scanner:enabled")).toBe(
      "true",
    );
  });

  it("lifts the camera toggle when the viewfinder reports a denied permission", async () => {
    window.localStorage.setItem("ucmc:gear-scanner:enabled", "true");
    renderControls();

    scannerProps.current?.onEnabledChange(false);

    expect(
      await screen.findByRole("button", { name: "Camera", pressed: false }),
    ).toBeInTheDocument();
  });

  it("describes the handheld's readiness to screen readers, since a tooltip never opens on touch", async () => {
    renderControls();
    const handheld = screen.getByRole("button", { name: "Handheld scanner" });

    expect(handheld).toHaveAccessibleDescription(/ready/i);

    await userEvent.click(handheld);

    expect(handheld).toHaveAccessibleDescription("Handheld scanner off");
  });
});
