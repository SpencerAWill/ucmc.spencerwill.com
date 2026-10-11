import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GearDeskCheckinPane } from "#/features/gear/components/gear-desk-checkin-pane";
import type { DeskCountedLoan } from "#/features/gear/server/loans-actions.server";

// ── module mocks ────────────────────────────────────────────────────────

const toastSuccessMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: toastSuccessMock, warning: vi.fn() },
}));

vi.mock("#/features/gear/api/queries", () => ({
  fetchGearByCode: vi.fn(),
}));

const checkinMutateMock = vi.hoisted(() => vi.fn());
vi.mock("#/features/gear/api/use-checkin-loans", () => ({
  useCheckinLoans: () => ({ mutate: checkinMutateMock, isPending: false }),
}));

vi.mock("#/features/gear/components/desk-scan-controls", () => ({
  DeskScanControls: () => <div data-testid="scan-controls" />,
}));

// The combobox's "Counted" group is how an open counted loan joins the
// batch; its props are captured so a test can pick one.
const comboboxProps = vi.hoisted<{
  current: { onPickCounted: (loan: DeskCountedLoan) => void } | null;
}>(() => ({ current: null }));
vi.mock("#/features/gear/components/gear-code-search-combobox", () => ({
  GearCodeSearchCombobox: (props: {
    onPickCounted: (loan: DeskCountedLoan) => void;
  }) => {
    comboboxProps.current = props;
    return <div data-testid="gear-combobox" />;
  },
}));

vi.mock("#/features/gear/components/gear-desk-item-row", () => ({
  CheckinItemRow: () => <tr />,
  CountedCheckinItemRow: ({
    loan,
    quantity,
    onQuantityChange,
    error,
  }: {
    loan: DeskCountedLoan;
    quantity: number;
    onQuantityChange: (q: number) => void;
    error?: string;
  }) => (
    <tr>
      <td data-testid={`counted-${loan.loanPublicId}`}>
        {quantity} of {loan.outstanding}
        <button type="button" onClick={() => onQuantityChange(quantity - 1)}>
          fewer {loan.loanPublicId}
        </button>
        {error ? (
          <span data-testid={`error-${loan.loanPublicId}`}>{error}</span>
        ) : null}
      </td>
    </tr>
  ),
}));

// ── helpers ─────────────────────────────────────────────────────────────

function makeLoan(overrides: Partial<DeskCountedLoan> = {}): DeskCountedLoan {
  return {
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
    ...overrides,
  };
}

function renderPane() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <GearDeskCheckinPane onSuccess={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  checkinMutateMock.mockReset();
  toastSuccessMock.mockReset();
  comboboxProps.current = null;
});

// ── tests ───────────────────────────────────────────────────────────────

describe("GearDeskCheckinPane counted rows", () => {
  it("prefills a picked loan to everything still out", async () => {
    renderPane();

    act(() =>
      comboboxProps.current!.onPickCounted(makeLoan({ outstanding: 4 })),
    );

    expect(await screen.findByTestId("counted-loan_riley")).toHaveTextContent(
      "4 of 4",
    );
    expect(
      screen.getByRole("button", { name: /^Check in 4 items$/ }),
    ).toBeInTheDocument();
  });

  it("submits a short return against the loan, not the model", async () => {
    renderPane();
    act(() => comboboxProps.current!.onPickCounted(makeLoan()));
    await userEvent.click(
      await screen.findByRole("button", { name: "fewer loan_riley" }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /^Check in 5 items$/ }),
    );

    expect(checkinMutateMock.mock.calls[0]?.[0]).toEqual({
      items: [
        {
          kind: "counted",
          loanPublicId: "loan_riley",
          quantity: 5,
          notes: null,
        },
      ],
    });
  });

  it("says what is still out after a short return", async () => {
    renderPane();
    act(() => comboboxProps.current!.onPickCounted(makeLoan()));
    await userEvent.click(
      await screen.findByRole("button", { name: /^Check in/ }),
    );
    const onSuccess = checkinMutateMock.mock.calls[0]?.[1]?.onSuccess;

    act(() => {
      onSuccess({
        results: [
          {
            ok: true,
            kind: "counted",
            loanPublicId: "loan_riley",
            memberPublicId: "u_riley",
            memberFullName: "Riley Chen",
            overdue: false,
            quantity: 5,
            outstanding: 1,
          },
        ],
      });
    });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Checked in 5 pieces from Riley Chen (1 still out)",
    );
    expect(screen.queryByTestId("counted-loan_riley")).not.toBeInTheDocument();
  });

  it("keeps a refused row with how many are actually out", async () => {
    renderPane();
    act(() => comboboxProps.current!.onPickCounted(makeLoan()));
    await userEvent.click(
      await screen.findByRole("button", { name: /^Check in/ }),
    );
    const onSuccess = checkinMutateMock.mock.calls[0]?.[1]?.onSuccess;

    act(() => {
      onSuccess({
        results: [
          {
            ok: false,
            kind: "counted",
            loanPublicId: "loan_riley",
            reason: "exceeds_outstanding",
            outstanding: 2,
          },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId("error-loan_riley")).toHaveTextContent(
        "Only 2 still out on this loan",
      ),
    );
  });
});
