import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FiledIssueView } from "#/features/site-feedback/components/composer/filed-issue-view";
import type { SiteFeedbackIssueDetail } from "#/features/site-feedback/server/site-feedback-triage-fns";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "#/features/site-feedback/api/use-post-pending-site-feedback-reports",
  () => ({
    usePostPendingSiteFeedbackReports: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  }),
);
vi.mock("#/features/site-feedback/api/use-update-site-feedback-quote", () => ({
  useUpdateSiteFeedbackQuote: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));
vi.mock("#/features/site-feedback/api/use-unlink-site-feedback", () => ({
  useUnlinkSiteFeedback: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function link(id: string, posted: boolean) {
  return {
    feedbackId: id,
    kind: "bug" as const,
    title: `Report ${id}`,
    quotedMd: "quote",
    postedAt: posted ? Temporal.Instant.from("2026-10-01T00:00:00Z") : null,
  };
}

function issue(unpostedCount: number): SiteFeedbackIssueDetail {
  return {
    id: "sfi_1",
    state: "open",
    title: "Filed",
    githubNumber: 42,
    githubUrl: "https://github.com/o/r/issues/42",
    reportCount: 3,
    unpostedCount,
    updatedAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
    summaryMd: "s",
    labels: [],
    githubConfigured: true,
    githubRepo: "example/repo",
    links: [
      link("a", true),
      link("b", false),
      link("c", unpostedCount > 1),
    ].map((l, i) =>
      i === 2 && unpostedCount === 2 ? { ...l, postedAt: null } : l,
    ),
  };
}

describe("FiledIssueView", () => {
  it("shows the header and the post button only when reports are unposted", () => {
    const { rerender } = render(<FiledIssueView issue={issue(2)} />);
    expect(screen.getByText(/#42/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /View on GitHub/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Post 2 new reports" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Edits made here after posting don't change GitHub."),
    ).toBeTruthy();
    rerender(
      <FiledIssueView issue={{ ...issue(0), links: [link("a", true)] }} />,
    );
    expect(
      screen.queryByRole("button", { name: /Post .* new report/ }),
    ).toBeNull();
  });
});
