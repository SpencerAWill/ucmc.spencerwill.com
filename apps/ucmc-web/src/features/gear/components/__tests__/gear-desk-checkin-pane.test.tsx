import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GearDeskCheckinPane } from "#/features/gear/components/gear-desk-checkin-pane";
import { MODEL_LABEL_PREFIX } from "#/features/gear/lib/model-label";
import type { DeskCountedLoan } from "#/features/gear/server/loans-actions.server";

// ── module mocks ────────────────────────────────────────────────────────

const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    warning: vi.fn(),
  },
}));

const fetchLoansForModelMock = vi.hoisted(() => vi.fn());
vi.mock("#/features/gear/api/queries", () => ({
  fetchGearByCode: vi.fn(),
  fetchOpenCountedLoansForModel: fetchLoansForModelMock,
}));

const checkinMutateMock = vi.hoisted(() => vi.fn());
vi.mock("#/features/gear/api/use-checkin-loans", () => ({
  useCheckinLoans: () => ({ mutate: checkinMutateMock, isPending: false }),
}));

const onScanRef = vi.hoisted<{ current: ((raw: string) => unknown) | null }>(
  () => ({ current: null }),
);
vi.mock("#/features/gear/components/desk-scan-controls", () => ({
  DeskScanControls: ({ onScan }: { onScan: (raw: string) => unknown }) => {
    onScanRef.current = onScan;
    return <div data-testid="scan-controls" />;
  },
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
  fetchLoansForModelMock.mockReset();
  toastErrorMock.mockReset();
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

describe("GearDeskCheckinPane bin-label scans", () => {
  async function scanBin(): Promise<void> {
    await waitFor(() => expect(onScanRef.current).not.toBeNull());
    await act(async () => {
      await onScanRef.current!(`${MODEL_LABEL_PREFIX}model_draws`);
    });
  }

  it("adds the one open loan of the bin's model", async () => {
    fetchLoansForModelMock.mockResolvedValue([makeLoan()]);
    renderPane();

    await scanBin();

    expect(fetchLoansForModelMock).toHaveBeenCalledWith("model_draws");
    expect(await screen.findByTestId("counted-loan_riley")).toBeInTheDocument();
  });

  it("asks whose when two members have the same gear out", async () => {
    fetchLoansForModelMock.mockResolvedValue([
      makeLoan(),
      makeLoan({
        loanPublicId: "loan_sam",
        memberFullName: "Sam Okafor",
        outstanding: 2,
      }),
    ]);
    renderPane();

    await scanBin();
    const dialog = await screen.findByRole("dialog", {
      name: "Whose are these?",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Sam Okafor/ }),
    );

    expect(await screen.findByTestId("counted-loan_sam")).toHaveTextContent(
      "2 of 2",
    );
    expect(screen.queryByTestId("counted-loan_riley")).not.toBeInTheDocument();
  });

  it("says so when nobody has the gear out", async () => {
    fetchLoansForModelMock.mockResolvedValue([]);
    renderPane();

    await scanBin();

    expect(toastErrorMock).toHaveBeenCalledWith("Nobody has that gear out.");
  });
});
