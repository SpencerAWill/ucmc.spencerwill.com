import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GearSweepSheet } from "#/features/gear/components/gear-sweep-sheet";

// ── module mocks ────────────────────────────────────────────────────────

/** The server's view of whether a sweep is open. `closeSweepFn` flips it
 *  to null, exactly as closing does in D1 — which is the whole point of
 *  this test: the close makes its own query resolve to nothing. */
const openSweep = vi.hoisted<{ current: unknown }>(() => ({ current: null }));

const closeSweepFnMock = vi.hoisted(() => vi.fn());
const recordSweepEntryFnMock = vi.hoisted(() => vi.fn());

vi.mock("#/features/gear/server/gear-fns", () => ({
  getOpenSweepFn: vi.fn(async () => openSweep.current),
  startSweepFn: vi.fn(async () => ({ ok: true, publicId: "swp_1" })),
  closeSweepFn: closeSweepFnMock,
  recordSweepEntryFn: recordSweepEntryFnMock,
  listGearTypesFn: vi.fn(async () => []),
  listGearModelsFn: vi.fn(async () => []),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const SWEEP = {
  publicId: "swp_1",
  startedAt: new Date("2026-09-20T14:00:00Z"),
  startedByName: "Dana Officer",
  closedAt: null,
  notes: null,
  entries: [],
};

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GearSweepSheet open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  openSweep.current = SWEEP;
});

/**
 * Coverage for the close report — a pane that, until the mutation moved
 * up into `SweepBody`, had never once rendered in the browser and had no
 * tests at all.
 *
 * These pin what the report SAYS. They do not reproduce the bug that
 * hid it: that was an unmount race (React Query drops `mutate`-level
 * callbacks when the calling component unmounts, and awaiting the
 * invalidation unmounted it), and under jsdom the `act()` batching
 * around a click keeps the pane mounted right through the callback, so
 * these pass against the broken version too. Verified by hand in the
 * browser instead. What stops it coming back is structural — the close
 * state lives in the component that survives the invalidation.
 */
describe("<GearSweepSheet />", () => {
  it("shows what the close actually did", async () => {
    closeSweepFnMock.mockImplementation(async () => {
      openSweep.current = null;
      return {
        ok: true,
        markedMissing: [
          { publicId: "g1", code: "HN05", modelName: "Corax" },
          { publicId: "g2", code: null, modelName: "Momentum" },
        ],
        shortfalls: [],
      };
    });
    const user = userEvent.setup();
    renderSheet();

    const closeButton = await screen.findByRole("button", {
      name: /close sweep and mark/i,
    });
    await user.click(closeButton);

    expect(await screen.findByText(/2 marked missing/i)).toBeInTheDocument();
    expect(screen.getByText(/HN05/)).toBeInTheDocument();
    // And it must NOT have fallen through to the empty state, which is
    // what the bug looked like from the officer's side.
    expect(screen.queryByText(/no sweep is running/i)).not.toBeInTheDocument();
  });

  it("reports counted shortfalls without claiming anything was written off", async () => {
    closeSweepFnMock.mockImplementation(async () => {
      openSweep.current = null;
      return {
        ok: true,
        markedMissing: [],
        shortfalls: [
          {
            modelPublicId: "m1",
            modelName: "Djinn Axess 12cm",
            expected: 20,
            counted: 0,
            onLoan: 6,
            shortfall: 14,
          },
        ],
      };
    });
    const user = userEvent.setup();
    renderSheet();

    await user.click(
      await screen.findByRole("button", { name: /close sweep and mark/i }),
    );

    expect(await screen.findByText(/14 short/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been written off/i)).toBeVisible();
  });

  it("returns to the sweep surface once the report is dismissed", async () => {
    closeSweepFnMock.mockImplementation(async () => {
      openSweep.current = null;
      return { ok: true, markedMissing: [], shortfalls: [] };
    });
    const user = userEvent.setup();
    renderSheet();

    await user.click(
      await screen.findByRole("button", { name: /close sweep and mark/i }),
    );
    await user.click(await screen.findByRole("button", { name: /^done$/i }));

    await waitFor(() => {
      expect(screen.getByText(/no sweep is running/i)).toBeInTheDocument();
    });
  });
});
