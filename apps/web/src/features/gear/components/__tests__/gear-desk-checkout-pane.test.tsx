import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CART_TOKEN_PREFIX } from "#/features/gear/lib/cart-token";
import { GearDeskCheckoutPane } from "#/features/gear/components/gear-desk-checkout-pane";

// ── module mocks ────────────────────────────────────────────────────────

const resolveCartTokenFnMock = vi.hoisted(() => vi.fn());
const getMemberForLoanFnMock = vi.hoisted(() =>
  vi.fn(async ({ data }: { data: { publicId: string } }) => ({
    userId: "u_member",
    publicId: data.publicId,
    fullName: "Cart Member",
    primaryEmail: "member@example.com",
  })),
);
const fetchGearByCodeMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    warning: toastWarningMock,
  },
}));

vi.mock("#/features/gear/server/gear-fns", () => ({
  resolveCartTokenFn: resolveCartTokenFnMock,
  getMemberForLoanFn: getMemberForLoanFnMock,
}));

vi.mock("#/features/gear/api/queries", () => ({
  fetchGearByCode: fetchGearByCodeMock,
}));

const checkoutMutateMock = vi.hoisted(() => vi.fn());
vi.mock("#/features/gear/api/use-checkout-loans", () => ({
  useCheckoutLoans: () => ({ mutate: checkoutMutateMock, isPending: false }),
}));

// Inject a controllable scanner — the real one calls native
// BarcodeDetector or a WASM ponyfill, neither of which jsdom can
// drive. Expose its `onResult` via a global so tests fire scans.
const scannerOnResult = vi.hoisted<{ current: ((v: string) => void) | null }>(
  () => ({ current: null }),
);
vi.mock("#/features/gear/components/barcode-scanner", () => ({
  BarcodeScanner: ({ onResult }: { onResult: (v: string) => void }) => {
    scannerOnResult.current = onResult;
    return <div data-testid="scanner-stub" />;
  },
}));

// Trim everything else to dumb stubs — these tests only care about the
// cart-token branch in `handleScan` and the submit guard.
vi.mock("#/features/gear/components/member-search-combobox", () => ({
  MemberSearchCombobox: ({
    selected,
  }: {
    selected: { fullName: string } | null;
  }) => (
    <div data-testid="member-combobox">
      {selected ? selected.fullName : "(none)"}
    </div>
  ),
}));
vi.mock("#/features/gear/components/gear-code-search-combobox", () => ({
  GearCodeSearchCombobox: () => <div data-testid="gear-combobox" />,
}));
vi.mock("#/features/gear/components/due-date-picker", () => ({
  DueDatePicker: () => <div data-testid="due-picker" />,
}));
vi.mock("#/features/gear/components/gear-desk-item-row", () => ({
  CheckoutItemRow: ({
    row,
    error,
  }: {
    row: { code: string };
    error?: string;
  }) => (
    <tr>
      <td data-testid={`row-${row.code}`}>
        {row.code}
        {error ? <span data-testid={`error-${row.code}`}>{error}</span> : null}
      </td>
    </tr>
  ),
}));

// ── helpers ─────────────────────────────────────────────────────────────

function renderPane() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GearDeskCheckoutPane onSuccess={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resolveCartTokenFnMock.mockReset();
  getMemberForLoanFnMock.mockClear();
  fetchGearByCodeMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  toastWarningMock.mockReset();
  checkoutMutateMock.mockReset();
  scannerOnResult.current = null;
});

// ── tests ───────────────────────────────────────────────────────────────

describe("GearDeskCheckoutPane cart-token branch", () => {
  it("seeds member + items from a valid cart-token scan", async () => {
    resolveCartTokenFnMock.mockResolvedValue({
      ok: true,
      cart: {
        memberPublicId: "u_member_public",
        memberFullName: "Cart Member",
        primaryEmail: "member@example.com",
        items: [
          {
            publicId: "gear_a",
            code: "CR1",
            description: "Test piece A",
            typeName: "Harness",
            thumbnailKey: null,
            lifecycle: "active",
            condition: "serviceable",
            hasOpenLoan: false,
            openLoanMemberFullName: null,
            availability: "loanable",
            addedAt: 1,
          },
        ],
      },
    });
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());

    await scannerOnResult.current!(`${CART_TOKEN_PREFIX}token-abc`);

    await waitFor(() =>
      expect(screen.getByTestId("row-CR1")).toBeInTheDocument(),
    );
    expect(resolveCartTokenFnMock).toHaveBeenCalledWith({
      data: { token: `${CART_TOKEN_PREFIX}token-abc` },
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      expect.stringContaining("Added 1 items from cart"),
    );
    expect(getMemberForLoanFnMock).toHaveBeenCalled();
  });

  it("flags unavailable cart items inline and blocks submit until they're removed", async () => {
    resolveCartTokenFnMock.mockResolvedValue({
      ok: true,
      cart: {
        memberPublicId: "u_member_public",
        memberFullName: "Cart Member",
        primaryEmail: "member@example.com",
        items: [
          {
            publicId: "gear_a",
            code: "CR1",
            description: "Loanable",
            typeName: "Harness",
            thumbnailKey: null,
            lifecycle: "active",
            condition: "serviceable",
            hasOpenLoan: false,
            openLoanMemberFullName: null,
            availability: "loanable",
            addedAt: 1,
          },
          {
            publicId: "gear_b",
            code: "CR2",
            description: "Already out",
            typeName: "Harness",
            thumbnailKey: null,
            lifecycle: "active",
            condition: "serviceable",
            hasOpenLoan: true,
            openLoanMemberFullName: "Other Borrower",
            availability: "on_loan",
            addedAt: 2,
          },
        ],
      },
    });
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());

    await scannerOnResult.current!(`${CART_TOKEN_PREFIX}t`);
    await waitFor(() =>
      expect(screen.getByTestId("error-CR2")).toBeInTheDocument(),
    );
    expect(toastWarningMock).toHaveBeenCalledWith(
      expect.stringContaining("need attention"),
    );

    const submit = screen.getByRole("button", {
      name: /check out/i,
    });
    await userEvent.click(submit);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Remove unavailable items before checking out.",
    );
    expect(checkoutMutateMock).not.toHaveBeenCalled();
  });

  it("toasts cart-expired when resolve returns reason 'expired'", async () => {
    resolveCartTokenFnMock.mockResolvedValue({
      ok: false,
      reason: "expired",
    });
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());

    await scannerOnResult.current!(`${CART_TOKEN_PREFIX}whatever`);

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("Cart QR expired"),
      ),
    );
  });

  it("falls through to raw-code lookup when scanned value lacks the cart prefix", async () => {
    fetchGearByCodeMock.mockResolvedValue(null);
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());

    await scannerOnResult.current!("CR42");

    await waitFor(() =>
      expect(fetchGearByCodeMock).toHaveBeenCalledWith("CR42"),
    );
    expect(resolveCartTokenFnMock).not.toHaveBeenCalled();
  });
});
