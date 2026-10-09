import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CART_TOKEN_PREFIX } from "#/features/gear/lib/cart-token";
import { WEDGE_SENTINEL } from "#/features/gear/lib/wedge-buffer";
import { GearDeskCheckoutPane } from "#/features/gear/components/gear-desk-checkout-pane";
import type { LoanDefaults } from "#/features/gear/server/loans-actions.server";

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
  // The pane reads `gear.defaultLoanDays` and `gear.caveOpenDays` for its
  // duration prefill. Neither value matters to any case here, but the
  // factory has to exist or `useQuery` throws before the component
  // renders at all — and the payload must be a COMPLETE `LoanDefaults`,
  // because the prefill reads `caveOpenWeekdays.length` and a partial
  // stub throws from inside an effect, which surfaces as every row in
  // the pane failing to render rather than as a bad stub.
  loanDefaultsQueryOptions: () => ({
    queryKey: ["stub", "loan-defaults"],
    queryFn: async (): Promise<LoanDefaults> => ({
      defaultLoanDays: 7,
      caveOpenWeekdays: [],
    }),
  }),
}));

// The override affordance is `gear:manage`-gated; the permission list
// is per-test so both sides of that gate are reachable.
const viewerPermissions = vi.hoisted<{ current: string[] }>(() => ({
  current: ["gear:loan"],
}));
vi.mock("#/features/auth/api/use-auth", async () => {
  const { authStub } = await import("#/test-support/auth-stub");
  return { useAuth: () => authStub(viewerPermissions.current) };
});

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
// A CONTROLLED input wearing `data-wedge-capture`, standing in for the
// real combobox. Controlled is the load-bearing part: the hook clears a
// scan target through the prototype's value setter precisely because
// assigning `.value` on a React-controlled input leaves state stale and
// the next render puts the character back. An uncontrolled stub would
// pass either way.
vi.mock("#/features/gear/components/gear-code-search-combobox", () => ({
  GearCodeSearchCombobox: () => {
    const [value, setValue] = React.useState("");
    return (
      <input
        data-testid="gear-combobox"
        data-wedge-capture=""
        aria-label="Gear code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  },
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
  viewerPermissions.current = ["gear:loan"];
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
            typeName: "Harness",
            thumbnailKey: null,
            status: "active",
            condition: "serviceable",
            hasOpenLoan: false,
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
            typeName: "Harness",
            thumbnailKey: null,
            status: "active",
            condition: "serviceable",
            hasOpenLoan: false,
            availability: "loanable",
            addedAt: 1,
          },
          {
            publicId: "gear_b",
            code: "CR2",
            typeName: "Harness",
            thumbnailKey: null,
            status: "active",
            condition: "serviceable",
            hasOpenLoan: true,
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

describe("GearDeskCheckoutPane officer override", () => {
  /** Scans one loanable piece in, submits, then replays the server
   *  refusing it — the only way a row gets a `blocked` reason. */
  async function refuseOnePiece(
    reason: "on_hold" | "already_on_loan",
  ): Promise<void> {
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
            typeName: "Harness",
            thumbnailKey: null,
            status: "active",
            condition: "serviceable",
            hasOpenLoan: false,
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

    await userEvent.click(screen.getByRole("button", { name: /^Check out/ }));
    const onSuccess = checkoutMutateMock.mock.calls[0]?.[1]?.onSuccess;
    act(() => {
      onSuccess({
        results: [{ ok: false, gearPublicId: "gear_a", reason }],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("error-CR1")).toBeInTheDocument(),
    );
  }

  it("offers no override to a keeper without gear:manage", async () => {
    viewerPermissions.current = ["gear:loan"];
    await refuseOnePiece("on_hold");

    expect(
      screen.queryByRole("button", { name: "Override and check out" }),
    ).not.toBeInTheDocument();
  });

  it("offers no override for a refusal that isn't overridable", async () => {
    viewerPermissions.current = ["gear:loan", "gear:manage"];
    // A piece someone else already has out doesn't come back because an
    // officer clicked twice.
    await refuseOnePiece("already_on_loan");

    expect(
      screen.queryByRole("button", { name: "Override and check out" }),
    ).not.toBeInTheDocument();
  });

  it("resubmits the held row with overrideHolds after a confirm", async () => {
    viewerPermissions.current = ["gear:loan", "gear:manage"];
    await refuseOnePiece("on_hold");

    await userEvent.click(
      screen.getByRole("button", { name: "Override and check out" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Override and check out" }),
    );

    expect(checkoutMutateMock).toHaveBeenCalledTimes(2);
    expect(checkoutMutateMock.mock.calls[1]?.[0]).toMatchObject({
      memberPublicId: "u_member_public",
      items: [{ gearPublicId: "gear_a", durationDays: expect.any(Number) }],
      overrideHolds: true,
    });
    // Only the flag the refusal called for — a hold override is not a
    // standing override.
    expect(checkoutMutateMock.mock.calls[1]?.[0]).not.toHaveProperty(
      "overrideStanding",
    );
  });
});

describe("GearDeskCheckoutPane keyboard-wedge branch", () => {
  /**
   * Drive a synthetic wedge burst. `user-event` with `delay: null`
   * dispatches without awaiting a timer between keys, which puts every
   * `timeStamp` gap at or near zero — machine speed by construction,
   * which is exactly the signature being asserted on.
   *
   * The timing MATRIX (slow bursts, stray keys, overflow) belongs to
   * `wedge-buffer.test.ts`, where the clock is a parameter. What can
   * only be seen here is the seam: the document listener, the focus
   * rules, and `preventDefault`.
   */
  const wedge = async (payload: string) => {
    const user = userEvent.setup({ delay: null });
    await user.keyboard(`${payload}{Enter}`);
  };

  /**
   * Dispatch a burst as raw `KeyboardEvent`s so each one's
   * `defaultPrevented` can be inspected. `user-event` owns the
   * ordinary cases; this exists only where the assertion is about
   * `preventDefault` itself. Timestamps are left to jsdom, which
   * stamps them from `performance.now()` at construction — synchronous
   * dispatch puts every gap at or near zero.
   *
   * Returns the terminator event.
   */
  const dispatchBurst = (payload: string): KeyboardEvent => {
    const events = [...payload, "Enter"].map(
      (key) =>
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
    act(() => {
      for (const event of events) {
        (document.activeElement ?? document.body).dispatchEvent(event);
      }
    });
    return events[events.length - 1];
  };

  const GEAR_ROW = {
    publicId: "gear_w",
    code: "CH93",
    name: "Black Diamond Momentum",
    typeName: "Harness",
    thumbnailKey: null,
    status: "active",
    condition: "serviceable",
    hasOpenLoan: false,
    openLoanMemberFullName: null,
    openLoanMemberAvatarKey: null,
  };

  it("adds a row from a burst typed with nothing focused", async () => {
    fetchGearByCodeMock.mockResolvedValue(GEAR_ROW);
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());

    await wedge("CH93");

    await waitFor(() =>
      expect(screen.getByTestId("row-CH93")).toBeInTheDocument(),
    );
    // Resolved exactly, through the same path the camera scanner uses.
    expect(fetchGearByCodeMock).toHaveBeenCalledWith("CH93");
  });

  it("strips an AIM symbology identifier before the lookup", async () => {
    // `]C0` is plain CODE128 — what our labels transmit once the gun's
    // "Transmit Code ID Character" is set to AIM.
    fetchGearByCodeMock.mockResolvedValue(GEAR_ROW);
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());

    await wedge("]C0CH93");

    await waitFor(() =>
      expect(fetchGearByCodeMock).toHaveBeenCalledWith("CH93"),
    );
  });

  it("leaves real typing in the notes field alone", async () => {
    // A bare burst is only a GUESS that a machine is typing, so it must
    // never eat what an officer is writing.
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());
    const notes = screen.getByLabelText(/notes/i);
    const user = userEvent.setup({ delay: null });
    await user.click(notes);

    await user.keyboard("CH93");

    expect(notes).toHaveValue("CH93");
    expect(fetchGearByCodeMock).not.toHaveBeenCalled();
  });

  it("captures a sentinel burst even inside the notes field", async () => {
    // The payoff for configuring the gun: a burst that announces itself
    // is unambiguous, so there is nothing to protect typing from.
    fetchGearByCodeMock.mockResolvedValue(GEAR_ROW);
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());
    const notes = screen.getByLabelText(/notes/i);
    const user = userEvent.setup({ delay: null });
    await user.click(notes);

    await user.keyboard(`${WEDGE_SENTINEL}CH93{Enter}`);

    await waitFor(() =>
      expect(fetchGearByCodeMock).toHaveBeenCalledWith("CH93"),
    );
    expect(notes).toHaveValue("");
  });

  it("calls preventDefault on a terminator that completes a scan", async () => {
    // The failure this exists for: the desk carries a live "Check out N
    // items" button, Radix focuses something when the Sheet opens, and
    // an uncaptured Enter submits the batch mid-scan. A Tab terminator
    // moves focus instead, which is just as wrong.
    //
    // Asserted on `defaultPrevented` rather than on the button not
    // firing, because **jsdom does not synthesize a click from Enter on
    // a focused button** — an assertion phrased that way passes whether
    // or not the terminator is captured, which is how it was written
    // the first time. `preventDefault` IS the mechanism; pin it.
    fetchGearByCodeMock.mockResolvedValue(GEAR_ROW);
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());
    screen.getByRole("button", { name: /check out/i }).focus();

    const enter = dispatchBurst("CH93");

    expect(enter.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("row-CH93")).toBeInTheDocument(),
    );
  });

  it("leaves a bare Enter to the page when no scan is in flight", async () => {
    // The other half of the same rule. Swallowing every terminator
    // would make the submit button unreachable by keyboard.
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.body.dispatchEvent(enter);
    });

    expect(enter.defaultPrevented).toBe(false);
  });

  it("reports an unrecognised payload instead of looking it up", async () => {
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());

    await scannerOnResult.current!("CH 93");

    expect(toastErrorMock).toHaveBeenCalledWith(
      "That didn't look like a gear label.",
    );
    expect(fetchGearByCodeMock).not.toHaveBeenCalled();
  });

  it("leaves no stray character behind in a declared scan target", async () => {
    // The first keystroke of a tier-2 burst cannot be judged, so it
    // reaches the field. Harmless almost everywhere — but this field is
    // scanned into repeatedly and queries on its value, so one leftover
    // per scan accumulates into `SSS` and a dropdown of nonsense.
    fetchGearByCodeMock.mockResolvedValue(GEAR_ROW);
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());
    const combobox = screen.getByTestId("gear-combobox");
    const user = userEvent.setup({ delay: null });
    await user.click(combobox);

    await user.keyboard("CH93{Enter}");

    await waitFor(() =>
      expect(fetchGearByCodeMock).toHaveBeenCalledWith("CH93"),
    );
    expect(combobox).toHaveValue("");
  });

  it("resolves a burst in a scan target exactly, not by prefix match", async () => {
    // The reason the attribute exists. That input is already an
    // accidental wedge target, but cmdk picks the first PREFIX match
    // while `handleScan` looks the code up exactly — so without the
    // opt-out one trigger pull means two different things depending on
    // where focus sat.
    fetchGearByCodeMock.mockResolvedValue(GEAR_ROW);
    renderPane();
    await waitFor(() => expect(scannerOnResult.current).not.toBeNull());
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("gear-combobox"));

    await user.keyboard("CH93{Enter}");

    await waitFor(() =>
      expect(screen.getByTestId("row-CH93")).toBeInTheDocument(),
    );
    expect(fetchGearByCodeMock).toHaveBeenCalledWith("CH93");
  });

  it("does not swallow hand-typed characters in the code box", () => {
    // The field is a declared scan target, which also makes it the
    // place an officer types a code by hand. A fast digraph inside
    // `maxInterKeyMs` used to read as machine speed and the character
    // vanished — with no emit to follow, nothing ever put it back.
    //
    // Dispatched as raw events so the inter-key gaps are real
    // timestamps rather than user-event's scheduling.
    renderPane();
    const combobox = screen.getByTestId("gear-combobox");
    act(() => {
      combobox.focus();
    });

    for (const key of [..."CH93"]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        combobox.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(fetchGearByCodeMock).not.toHaveBeenCalled();
  });

  it("does not let held-down key repeats fabricate a scan", () => {
    // Auto-repeat fires around every 30 ms, inside `maxInterKeyMs`, so
    // a held key reads as a machine typing. With focus somewhere that
    // takes no text — a button, which is where Radix leaves it when the
    // Sheet opens — leaning on a key long enough builds a buffer past
    // `minLength`, and the next Enter submits it as a scan.
    //
    // The pass-through fix covers the code box; this is the exposure it
    // does not reach.
    renderPane();
    act(() => {
      screen.getByRole("button", { name: /check out/i }).focus();
    });

    act(() => {
      for (const repeat of [false, true, true, true, true, true]) {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "9",
            repeat,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(fetchGearByCodeMock).not.toHaveBeenCalled();
  });

  it("does not show a scan confirmation for an unrecognised payload", () => {
    // The green line and the error toast are answers to the same
    // trigger pull and must not contradict each other.
    renderPane();

    act(() => {
      scannerOnResult.current?.("CH 93");
    });

    expect(screen.queryByText(/scanned/i)).not.toBeInTheDocument();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "That didn't look like a gear label.",
    );
  });
});
