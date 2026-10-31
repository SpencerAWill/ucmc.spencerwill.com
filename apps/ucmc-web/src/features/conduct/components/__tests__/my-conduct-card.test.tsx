import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MyConductCard } from "#/features/conduct/components/my-conduct-card";
import { APPEAL_LINE } from "#/features/conduct/server/limits";
import { getMyActiveSanctionsFn } from "#/features/conduct/server/record-fns";

vi.mock("#/features/conduct/server/record-fns", () => ({
  getMyActiveSanctionsFn: vi.fn(),
}));

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MyConductCard />
    </QueryClientProvider>,
  );
}

describe("MyConductCard", () => {
  beforeEach(() => {
    vi.mocked(getMyActiveSanctionsFn).mockReset();
  });

  it("shows a suspension's statement, end date and the appeal route", async () => {
    vi.mocked(getMyActiveSanctionsFn).mockResolvedValue([
      {
        level: "suspension",
        statement: "You are suspended for unsafe belaying.",
        startsOn: Temporal.PlainDate.from("2026-10-20"),
        endsOn: Temporal.PlainDate.from("2026-11-10"),
      },
    ]);
    renderCard();
    expect(
      await screen.findByText("You are suspended for unsafe belaying."),
    ).toBeVisible();
    expect(screen.getByText("Suspension")).toBeVisible();
    expect(screen.getByText("until Nov 10, 2026")).toBeVisible();
    expect(screen.getByText(APPEAL_LINE)).toBeVisible();
  });

  it("marks a suspension that has not started yet", async () => {
    vi.mocked(getMyActiveSanctionsFn).mockResolvedValue([
      {
        level: "suspension",
        statement: "Later.",
        startsOn: Temporal.PlainDate.from("2099-01-05"),
        endsOn: Temporal.PlainDate.from("2099-02-05"),
      },
    ]);
    renderCard();
    expect(
      await screen.findByText("Starts Jan 5, 2099, until Feb 5, 2099"),
    ).toBeVisible();
  });

  it("renders nothing when there are no active sanctions", async () => {
    vi.mocked(getMyActiveSanctionsFn).mockResolvedValue([]);
    const { container } = renderCard();
    await waitFor(() => {
      expect(getMyActiveSanctionsFn).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });
});
