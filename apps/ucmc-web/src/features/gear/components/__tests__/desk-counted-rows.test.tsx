import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "#/components/ui/tooltip";
import { DeskQuantityInput } from "#/features/gear/components/desk-quantity-input";
import {
  CheckinItemRow,
  CheckoutItemRow,
  CountedCheckinItemRow,
  CountedCheckoutItemRow,
} from "#/features/gear/components/gear-desk-item-row";
import type {
  DeskCountedLoan,
  DeskCountedModel,
} from "#/features/gear/server/loans-actions.server";

vi.mock("#/features/gear/components/due-date-picker", () => ({
  DueDatePicker: () => <div data-testid="due-picker" />,
}));

const draws: DeskCountedModel = {
  publicId: "model_draws",
  name: "BD HotForge 12cm",
  typeName: "Quickdraw",
  imageKey: null,
  takeable: 4,
  held: 6,
};

const rileysLoan: DeskCountedLoan = {
  loanPublicId: "loan_riley",
  modelPublicId: "model_draws",
  name: "BD HotForge 12cm",
  typeName: "Quickdraw",
  thumbnailKey: null,
  quantity: 6,
  outstanding: 6,
  memberPublicId: "u_riley",
  memberFullName: "Riley Chen",
  memberAvatarKey: null,
  dueAt: Temporal.Instant.from("2026-10-14T03:59:59Z"),
};

// The app root mounts a TooltipProvider; the check-in row's borrower
// avatar needs one.
function inTable(node: React.ReactNode) {
  return render(
    <TooltipProvider>
      <table>
        <tbody>{node}</tbody>
      </table>
    </TooltipProvider>,
  );
}

describe("DeskQuantityInput", () => {
  function Harness({ max = 10 }: { max?: number }) {
    const [value, setValue] = useState(1);
    return (
      <>
        <DeskQuantityInput
          id="q"
          value={value}
          onChange={setValue}
          max={max}
          label="Quantity"
        />
        <output data-testid="committed">{value}</output>
      </>
    );
  }

  it("lets the officer clear the box and type a two-digit number", async () => {
    render(<Harness max={20} />);
    const input = screen.getByRole("spinbutton", { name: "Quantity" });

    await userEvent.clear(input);
    await userEvent.type(input, "12");

    // Cleared, the draft is blank but the parent still holds 1 — nothing
    // snapped back mid-edit — and the finished number commits.
    expect(input).toHaveValue(12);
    expect(screen.getByTestId("committed")).toHaveTextContent("12");
  });

  it("never commits a number past max, and restores on blur", async () => {
    render(<Harness max={5} />);
    const input = screen.getByRole("spinbutton", { name: "Quantity" });

    await userEvent.clear(input);
    await userEvent.type(input, "9");
    await userEvent.tab();

    expect(screen.getByTestId("committed")).toHaveTextContent("1");
    expect(input).toHaveValue(1);
  });
});

describe("CountedCheckoutItemRow", () => {
  it("names the model and what's left on a line of its own", () => {
    inTable(
      <CountedCheckoutItemRow
        model={draws}
        quantity={2}
        onQuantityChange={() => {}}
        durationDays={7}
        onDurationChange={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText("BD HotForge 12cm")).toBeInTheDocument();
    expect(screen.getByText(/4 available · 6 held/)).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "Quantity of BD HotForge 12cm" }),
    ).toHaveValue(2);
  });

  it("advises against more than takeable without refusing it", () => {
    inTable(
      <CountedCheckoutItemRow
        model={draws}
        quantity={6}
        onQuantityChange={() => {}}
        durationDays={7}
        onDurationChange={() => {}}
        onRemove={() => {}}
      />,
    );

    // A manager may override into the held six, so the field stays
    // editable and the row submittable — this is advice, not a block.
    expect(screen.getByText("Only 4 available")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});

describe("CountedCheckinItemRow", () => {
  it("caps the return at what is still out", () => {
    inTable(
      <CountedCheckinItemRow
        loan={rileysLoan}
        quantity={6}
        onQuantityChange={() => {}}
        notes=""
        onNotesChange={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(
      screen.getByRole("spinbutton", {
        name: "Units of BD HotForge 12cm returned",
      }),
    ).toHaveAttribute("max", "6");
    expect(screen.getByText("of 6 out")).toBeInTheDocument();
  });

  it("warns that a short return leaves the loan open", () => {
    inTable(
      <CountedCheckinItemRow
        loan={rileysLoan}
        quantity={5}
        onQuantityChange={() => {}}
        notes=""
        onNotesChange={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(
      screen.getByText("1 still out — the loan stays open for it"),
    ).toBeInTheDocument();
  });
});

describe("coded rows name their gear too", () => {
  const harness = {
    publicId: "gear_corax",
    code: "CH93",
    name: "Petzl Corax",
    typeName: "Harness",
    thumbnailKey: null,
    status: "active" as const,
    condition: "serviceable" as const,
    hasOpenLoan: true,
    openLoanMemberFullName: "Riley Chen",
    openLoanMemberAvatarKey: null,
  };

  it("shows product and type under a checkout row", () => {
    inTable(
      <CheckoutItemRow
        row={harness}
        durationDays={7}
        onDurationChange={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText("Petzl Corax")).toBeInTheDocument();
    expect(screen.getByText(/· Harness/)).toBeInTheDocument();
  });

  it("shows product and type under a check-in row", () => {
    inTable(
      <CheckinItemRow
        row={harness}
        conditionAtReturn={null}
        onConditionChange={() => {}}
        notes=""
        onNotesChange={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText("Petzl Corax")).toBeInTheDocument();
    expect(screen.getByText(/· Harness/)).toBeInTheDocument();
  });
});
