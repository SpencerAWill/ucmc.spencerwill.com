import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoanWriteOffDialog } from "#/features/gear/components/loan-write-off-dialog";
import type { LoanDetail } from "#/features/gear/server/gear-fns";

const mutateMock = vi.hoisted(() => vi.fn());
vi.mock("#/features/gear/api/use-write-off-loan", () => ({
  useWriteOffLoan: () => ({ mutate: mutateMock, isPending: false }),
}));
const toastSuccessMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: vi.fn() },
}));

const loan: LoanDetail = {
  publicId: "loan_riley",
  gearPublicId: null,
  code: null,
  gearName: "BD HotForge 12cm",
  quantity: 6,
  quantityReturned: 5,
  quantityLost: 0,
  thumbnailKey: null,
  typeName: "Quickdraw",
  memberPublicId: "u_riley",
  memberFullName: "Riley Chen",
  memberAvatarKey: null,
  checkedOutAt: Temporal.Instant.from("2026-10-01T22:00:00Z"),
  dueAt: Temporal.Instant.from("2026-10-08T03:59:59Z"),
  returnedAt: null,
  checkoutNotes: null,
  checkinNotes: null,
  conditionAtReturn: null,
  checkedOutByName: "Desk Officer",
  returnedByName: null,
};

beforeEach(() => {
  mutateMock.mockReset();
  toastSuccessMock.mockReset();
});

describe("LoanWriteOffDialog", () => {
  it("names what is still out and won't submit without a reason", async () => {
    render(<LoanWriteOffDialog loan={loan} open onOpenChange={() => {}} />);

    expect(
      screen.getByRole("heading", { name: "Write off 1 still out?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write off 1" })).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Reason"), "   ");
    expect(screen.getByRole("button", { name: "Write off 1" })).toBeDisabled();
  });

  it("submits the trimmed reason and closes on success", async () => {
    const onOpenChange = vi.fn();
    render(<LoanWriteOffDialog loan={loan} open onOpenChange={onOpenChange} />);
    await userEvent.type(
      screen.getByLabelText("Reason"),
      "  Lost at Red River ",
    );

    await userEvent.click(screen.getByRole("button", { name: "Write off 1" }));
    expect(mutateMock.mock.calls[0]?.[0]).toEqual({
      publicId: "loan_riley",
      reason: "Lost at Red River",
    });
    mutateMock.mock.calls[0]?.[1]?.onSuccess({ ok: true, quantityLost: 1 });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Wrote off 1 and closed the loan.",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
