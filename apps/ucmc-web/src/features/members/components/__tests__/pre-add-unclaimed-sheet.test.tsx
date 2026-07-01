import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreAddUnclaimedSheet } from "#/features/members/components/pre-add-unclaimed-sheet";

const preAddUnclaimedFn = vi.fn();

vi.mock("#/features/members/server/member-fns", () => ({
  preAddUnclaimedFn: (...args: unknown[]) => preAddUnclaimedFn(...args),
}));

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PreAddUnclaimedSheet open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("PreAddUnclaimedSheet", () => {
  beforeEach(() => {
    preAddUnclaimedFn.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders one empty row by default with a disabled add button", () => {
    renderSheet();
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("");
    expect(screen.getByLabelText(/^email$/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: /^pre-add/i })).toBeDisabled();
  });

  it("enables submit once the row has a non-empty name and a valid email", async () => {
    const user = userEvent.setup();
    renderSheet();
    const submit = screen.getByRole("button", { name: /^pre-add/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^name$/i), "Alice");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/^email$/i), "alice@uc.edu");
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
  });

  it("appends a second row via 'Add row'", async () => {
    const user = userEvent.setup();
    renderSheet();
    expect(screen.getAllByLabelText(/^name$/i)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /add row/i }));
    expect(screen.getAllByLabelText(/^name$/i)).toHaveLength(2);
  });

  it("submits valid rows and renders the per-row skipped result", async () => {
    const user = userEvent.setup();
    preAddUnclaimedFn.mockResolvedValue({
      ok: true,
      created: [
        {
          userId: "user_1",
          publicId: "pub_1",
          name: "Alice",
          email: "alice@uc.edu",
        },
      ],
      skipped: [{ email: "bob@uc.edu", name: "Bob", reason: "email_taken" }],
    });
    renderSheet();

    // Row 1 — Alice
    const names = () => screen.getAllByLabelText(/^name$/i);
    const emails = () => screen.getAllByLabelText(/^email$/i);
    await user.type(names()[0], "Alice");
    await user.type(emails()[0], "alice@uc.edu");

    // Row 2 — Bob
    await user.click(screen.getByRole("button", { name: /add row/i }));
    await user.type(names()[1], "Bob");
    await user.type(emails()[1], "bob@uc.edu");

    await user.click(screen.getByRole("button", { name: /^pre-add/i }));

    await waitFor(() => {
      expect(preAddUnclaimedFn).toHaveBeenCalledWith({
        data: {
          entries: [
            { name: "Alice", email: "alice@uc.edu" },
            { name: "Bob", email: "bob@uc.edu" },
          ],
        },
      });
    });

    // Result alert appears with both counts.
    expect(await screen.findByText(/1 added, 1 skipped/i)).toBeInTheDocument();

    // The skipped row keeps its inputs and gets the destructive badge.
    // Scope the badge query to the row containing "Bob" via the
    // dedicated `data-testid` rather than coupling to a Tailwind class
    // — class names are layout details and shouldn't be locator
    // primitives.
    const remaining = screen.getByDisplayValue("Bob");
    expect(remaining).toBeInTheDocument();
    const rows = screen.getAllByTestId("unclaimed-row");
    const bobRow = rows.find((r) =>
      within(r).queryByDisplayValue("Bob") ? true : false,
    );
    expect(bobRow).toBeDefined();
    expect(
      within(bobRow as HTMLElement).getByText(/email already in use/i),
    ).toBeInTheDocument();

    // The successfully created row was dropped (no Alice input remains).
    expect(screen.queryByDisplayValue("Alice")).toBeNull();
  });
});
