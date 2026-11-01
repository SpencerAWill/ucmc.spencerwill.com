import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemberConductCard } from "#/features/conduct/components/member-conduct-card";
import type { MemberConductSummary } from "#/features/conduct/server/record-fns";
import { memberConductSummaryFn } from "#/features/conduct/server/record-fns";
import { renderWithRouter } from "#/test-support/router-harness";

vi.mock("#/features/conduct/server/record-fns", () => ({
  memberConductSummaryFn: vi.fn(),
}));

function summary(
  overrides: Partial<MemberConductSummary> = {},
): MemberConductSummary {
  return {
    counts: { note: 0, warning: 1, suspension: 1, termination: 0 },
    standing: {
      terminated: false,
      suspendedUntil: Temporal.PlainDate.from("2026-11-10"),
    },
    records: [
      {
        publicId: "crec_1",
        level: "suspension",
        startsOn: Temporal.PlainDate.from("2026-10-20"),
        liftedAt: null,
      },
    ],
    ...overrides,
  };
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithRouter(
    <QueryClientProvider client={client}>
      <MemberConductCard userId="u1" />
    </QueryClientProvider>,
  );
}

describe("MemberConductCard", () => {
  beforeEach(() => {
    vi.mocked(memberConductSummaryFn).mockReset();
  });

  it("summarises the counts and an active suspension", async () => {
    vi.mocked(memberConductSummaryFn).mockResolvedValue(summary());
    renderCard();
    expect(await screen.findByText("1 warning · 1 suspension")).toBeVisible();
    expect(screen.getByText("Suspended until Nov 10, 2026")).toBeVisible();
  });

  it("shows a termination as such", async () => {
    vi.mocked(memberConductSummaryFn).mockResolvedValue(
      summary({
        counts: { note: 0, warning: 0, suspension: 0, termination: 1 },
        standing: {
          terminated: true,
          suspendedUntil: null,
        },
      }),
    );
    renderCard();
    expect(await screen.findByText("Terminated")).toBeVisible();
  });

  it("renders nothing when the viewer may not see conduct", async () => {
    vi.mocked(memberConductSummaryFn).mockResolvedValue(null);
    renderCard();
    await vi.waitFor(() => {
      expect(memberConductSummaryFn).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Conduct")).toBeNull();
  });
});
