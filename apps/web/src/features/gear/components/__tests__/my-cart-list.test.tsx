import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MyCartList } from "#/features/gear/components/my-cart-list";

import type { MyCartResult } from "#/features/gear/server/gear-fns";

// ── module mocks ────────────────────────────────────────────────────────

const removeMutateMock = vi.hoisted(() => vi.fn());
const clearMutateMock = vi.hoisted(() => vi.fn());
const mintMutateAsyncMock = vi.hoisted(() =>
  vi.fn(async () => ({
    token: "ucmc-cart:fake",
    expiresAt: Date.now() + 60_000,
  })),
);

vi.mock("#/features/gear/api/use-remove-from-cart", () => ({
  useRemoveFromCart: () => ({ mutate: removeMutateMock, isPending: false }),
}));
vi.mock("#/features/gear/api/use-clear-cart", () => ({
  useClearCart: () => ({ mutate: clearMutateMock, isPending: false }),
}));
vi.mock("#/features/gear/api/use-mint-cart-token", () => ({
  useMintCartToken: () => ({ mutateAsync: mintMutateAsyncMock }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// Mock the cart-qr-dialog to a stub — actual canvas rendering needs
// the qrcode dep + a real canvas, which jsdom can't drive cleanly.
// The list-level tests don't care about the dialog body, only that
// it appears when the button is pressed.
vi.mock("#/features/gear/components/cart-qr-dialog", () => ({
  CartQrDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="cart-qr-dialog">qr open</div> : null,
}));

const myCartFnMock = vi.hoisted(() => vi.fn<() => Promise<MyCartResult>>());

vi.mock("#/features/gear/server/gear-fns", async () => {
  // Re-export the types/constants used by other modules but stub the
  // network-bound server-fn implementations to keep tests isolated.
  return {
    getMyCartFn: () => myCartFnMock(),
  };
});

// ── helpers ─────────────────────────────────────────────────────────────

function renderWithClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MyCartList />
    </QueryClientProvider>,
  );
}

function row(overrides: Partial<MyCartResult["items"][number]>) {
  return {
    publicId: "gear_a",
    code: "CR1",
    description: "Test piece",
    typeName: "Harness",
    thumbnailKey: null,
    lifecycle: "active" as const,
    condition: "serviceable" as const,
    hasOpenLoan: false,
    availability: "loanable" as const,
    addedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  removeMutateMock.mockReset();
  clearMutateMock.mockReset();
  mintMutateAsyncMock.mockClear();
  myCartFnMock.mockReset();
});

// ── tests ───────────────────────────────────────────────────────────────

describe("MyCartList", () => {
  it("renders the empty state with a link to /gear when the cart has no items", async () => {
    myCartFnMock.mockResolvedValue({ items: [] });
    renderWithClient();
    expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /gear/i })).toHaveAttribute(
      "href",
      "/gear",
    );
  });

  it("renders an availability badge per item, including a destructive variant for on_loan", async () => {
    myCartFnMock.mockResolvedValue({
      items: [
        row({ publicId: "gear_a", code: "CR1", availability: "loanable" }),
        row({
          publicId: "gear_b",
          code: "CR2",
          availability: "on_loan",
          hasOpenLoan: true,
        }),
        row({
          publicId: "gear_c",
          code: "CR3",
          availability: "not_serviceable",
          condition: "needs_repair",
        }),
      ],
    });
    renderWithClient();
    expect(await screen.findByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Currently on loan")).toBeInTheDocument();
    expect(screen.getByText("Out for repair")).toBeInTheDocument();
  });

  it("calls remove + clear mutations on the corresponding buttons", async () => {
    myCartFnMock.mockResolvedValue({
      items: [row({ publicId: "gear_a", code: "CR1" })],
    });
    renderWithClient();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /remove CR1 from cart/i }),
    );
    expect(removeMutateMock).toHaveBeenCalledWith(
      { gearPublicId: "gear_a" },
      expect.any(Object),
    );

    await user.click(screen.getByRole("button", { name: /clear cart/i }));
    expect(clearMutateMock).toHaveBeenCalled();
  });

  it("opens the QR dialog when the show-QR button is clicked", async () => {
    myCartFnMock.mockResolvedValue({
      items: [row({ publicId: "gear_a", code: "CR1" })],
    });
    renderWithClient();
    const user = userEvent.setup();

    expect(screen.queryByTestId("cart-qr-dialog")).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: /show QR at gear desk/i }),
    );
    expect(screen.getByTestId("cart-qr-dialog")).toBeInTheDocument();
  });
});
