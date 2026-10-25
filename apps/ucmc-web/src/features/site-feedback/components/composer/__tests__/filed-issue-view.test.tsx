import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FiledIssueView } from "#/features/site-feedback/components/composer/filed-issue-view";
import type { SiteFeedbackIssueDetail } from "#/features/site-feedback/server/site-feedback-triage-fns";

const postPending = vi.fn();
const fileIssue = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "#/features/site-feedback/api/use-post-pending-site-feedback-reports",
  () => ({
    usePostPendingSiteFeedbackReports: () => ({
      mutateAsync: postPending,
      isPending: false,
    }),
  }),
);
vi.mock("#/features/site-feedback/api/use-file-site-feedback-issue", () => ({
  useFileSiteFeedbackIssue: () => ({
    mutateAsync: fileIssue,
    isPending: false,
  }),
}));

beforeEach(() => {
  postPending.mockReset();
  fileIssue.mockReset();
});
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
    filingStartedAt: null,
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

  it("confirms before posting, naming the repo", async () => {
    postPending.mockResolvedValue({ ok: true, posted: 2 });
    const user = userEvent.setup();
    render(<FiledIssueView issue={issue(2)} />);
    await user.click(
      screen.getByRole("button", { name: "Post 2 new reports" }),
    );
    expect(postPending).not.toHaveBeenCalled();
    expect(
      screen.getByText("This posts 2 reports publicly to example/repo."),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Post to GitHub" }));
    await waitFor(() => {
      expect(postPending).toHaveBeenCalledWith("sfi_1");
    });
  });

  it("shows a refused post inline in the dialog", async () => {
    postPending.mockResolvedValue({
      ok: false,
      reason: "github_error",
      message: "GitHub refused the comment (403). Nothing was posted.",
    });
    const user = userEvent.setup();
    render(<FiledIssueView issue={issue(2)} />);
    await user.click(
      screen.getByRole("button", { name: "Post 2 new reports" }),
    );
    await user.click(screen.getByRole("button", { name: "Post to GitHub" }));
    expect(
      await screen.findByText(
        "GitHub refused the comment (403). Nothing was posted.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("says filing is in progress for a fresh claim", () => {
    render(
      <FiledIssueView
        issue={{
          ...issue(0),
          state: "filing",
          githubNumber: null,
          githubUrl: null,
          filingStartedAt: Temporal.Now.instant().subtract({ minutes: 1 }),
        }}
      />,
    );
    expect(screen.getByText("Filing in progress…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry filing" })).toBeNull();
  });

  it("offers a retry for a claim older than five minutes", async () => {
    fileIssue.mockResolvedValue({
      ok: false,
      reason: "github_error",
      message: "GitHub refused the issue (422). Nothing was filed.",
    });
    const user = userEvent.setup();
    render(
      <FiledIssueView
        issue={{
          ...issue(0),
          state: "filing",
          githubNumber: null,
          githubUrl: null,
          filingStartedAt: Temporal.Now.instant().subtract({ minutes: 6 }),
        }}
      />,
    );
    expect(screen.getByText("Filing didn't finish.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry filing" }));
    await waitFor(() => {
      expect(fileIssue).toHaveBeenCalledWith("sfi_1");
    });
    expect(
      await screen.findByText(
        "GitHub refused the issue (422). Nothing was filed.",
      ),
    ).toBeTruthy();
  });
});
