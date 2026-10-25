import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFeedbackCard } from "#/features/site-feedback/components/site-feedback-card";
import type { SiteFeedbackSummary } from "#/features/site-feedback/server/site-feedback-fns";

function baseRow(
  overrides: Partial<SiteFeedbackSummary> = {},
): SiteFeedbackSummary {
  return {
    id: "sfb_1",
    kind: "bug",
    title: "Map pins overlap",
    body: "Body content",
    status: "open",
    pageUrl: null,
    createdBy: "user_alice",
    createdByPublicId: "alice123",
    authorDisplayName: "Alice",
    authorAvatarKey: null,
    state: "new",
    trackedIn: [],
    screenshot: null,
    createdAt: Temporal.Instant.from("2026-05-01T12:00:00Z"),
    updatedAt: Temporal.Instant.from("2026-05-01T12:00:00Z"),
    ...overrides,
  };
}

describe("SiteFeedbackCard", () => {
  it("shows the tracked state and one link per tracking issue", () => {
    render(
      <SiteFeedbackCard
        entry={baseRow({
          state: "tracked",
          trackedIn: [
            { number: 12, url: "https://github.com/o/r/issues/12" },
            { number: 34, url: "https://github.com/o/r/issues/34" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Tracked")).toBeTruthy();
    const first = screen.getByRole("link", { name: /Tracked in #12/ });
    const second = screen.getByRole("link", { name: /Tracked in #34/ });
    expect(first.getAttribute("href")).toBe("https://github.com/o/r/issues/12");
    expect(second.getAttribute("href")).toBe(
      "https://github.com/o/r/issues/34",
    );
  });

  it("shows New and no link for an untriaged submission", () => {
    render(<SiteFeedbackCard entry={baseRow()} />);
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a thumbnail linking to the full image when present", () => {
    render(<SiteFeedbackCard entry={baseRow({ screenshot: "present" })} />);
    const link = screen.getByRole("link", { name: /screenshot/i });
    expect(link.getAttribute("href")).toBe(
      "/api/site-feedback/sfb_1/screenshot",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    const img = screen.getByRole("img", { name: /screenshot/i });
    expect(img.getAttribute("src")).toBe("/api/site-feedback/sfb_1/screenshot");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it('renders "Screenshot deleted 30 days after resolution." when purged', () => {
    render(<SiteFeedbackCard entry={baseRow({ screenshot: "purged" })} />);
    expect(
      screen.getByText("Screenshot deleted 30 days after resolution."),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders nothing about a screenshot when there never was one", () => {
    render(<SiteFeedbackCard entry={baseRow()} />);
    expect(screen.queryByText(/screenshot/i)).toBeNull();
  });
});
