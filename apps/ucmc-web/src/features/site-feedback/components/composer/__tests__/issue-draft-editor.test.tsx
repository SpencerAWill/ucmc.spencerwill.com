import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IssueDraftEditor } from "#/features/site-feedback/components/composer/issue-draft-editor";
import type { SiteFeedbackIssueDetail } from "#/features/site-feedback/server/site-feedback-triage-fns";

const updateDraft = vi.fn();
const fileIssue = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "#/features/site-feedback/api/use-update-site-feedback-issue-draft",
  () => ({
    useUpdateSiteFeedbackIssueDraft: () => ({ mutateAsync: updateDraft }),
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
vi.mock(
  "#/features/site-feedback/api/use-delete-site-feedback-issue-draft",
  () => ({
    useDeleteSiteFeedbackIssueDraft: () => ({
      mutateAsync: vi.fn(),
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

const issue: SiteFeedbackIssueDetail = {
  id: "sfi_1",
  state: "draft",
  title: "Old title",
  githubNumber: null,
  githubUrl: null,
  reportCount: 1,
  unpostedCount: 1,
  updatedAt: Temporal.Instant.fromEpochMilliseconds(1000),
  summaryMd: null,
  labels: ["bug"],
  githubConfigured: true,
  githubRepo: "example/repo",
  filingStartedAt: null,
  links: [
    {
      feedbackId: "fb_1",
      kind: "bug",
      title: "Broken",
      quotedMd: "It broke",
      postedAt: null,
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  updateDraft.mockReset();
  fileIssue.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

function typeTitle(value: string) {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value } });
}

async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("IssueDraftEditor", () => {
  it("autosaves once after 1000ms with the latest title and token", async () => {
    updateDraft.mockResolvedValue({ ok: true, updatedAtMs: 2000 });
    render(<IssueDraftEditor issue={issue} />);
    typeTitle("New");
    typeTitle("New title");
    await elapse(1000);
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith({
      id: "sfi_1",
      title: "New title",
      summaryMd: "",
      labels: ["bug"],
      expectedUpdatedAtMs: 1000,
    });
  });

  it("shows the conflict copy and stops autosaving", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "conflict" });
    render(<IssueDraftEditor issue={issue} />);
    typeTitle("Old title!");
    await elapse(1000);
    expect(
      screen.getByText(
        "Someone else edited this draft. Reload to see their changes.",
      ),
    ).toBeTruthy();
    typeTitle("Old title?");
    await elapse(5000);
    expect(updateDraft).toHaveBeenCalledTimes(1);
  });

  it("disables filing and explains when GitHub is not configured", () => {
    render(<IssueDraftEditor issue={{ ...issue, githubConfigured: false }} />);
    expect(
      screen.getByRole("button", { name: "File on GitHub" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByText("GitHub isn't configured, so filing is off."),
    ).toBeTruthy();
  });

  it("shows the error status when a save throws, then retries the edit", async () => {
    updateDraft.mockRejectedValueOnce(new Error("offline"));
    updateDraft.mockResolvedValue({ ok: true, updatedAtMs: 2000 });
    render(<IssueDraftEditor issue={issue} />);
    typeTitle("Edited");
    await elapse(1000);
    expect(
      screen.getByText("Couldn't save. Will retry on your next edit."),
    ).toBeTruthy();
    typeTitle("Edited again");
    await elapse(1000);
    expect(updateDraft).toHaveBeenCalledTimes(2);
    expect(updateDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Edited again",
        expectedUpdatedAtMs: 1000,
      }),
    );
    expect(screen.queryByText(/Couldn't save/)).toBeNull();
  });

  it("disables filing while the title is blank", () => {
    render(<IssueDraftEditor issue={issue} />);
    typeTitle("   ");
    expect(
      screen.getByRole("button", { name: "File on GitHub" }),
    ).toHaveProperty("disabled", true);
  });

  it("offers a reload on the conflict message", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "conflict" });
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      reload,
    });
    render(<IssueDraftEditor issue={issue} />);
    typeTitle("Old title!");
    await elapse(1000);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalled();
  });

  it("shows the not_draft copy when the flush before filing finds it filed", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "not_draft" });
    render(<IssueDraftEditor issue={issue} />);
    typeTitle("Edited");
    fireEvent.click(screen.getByRole("button", { name: "File on GitHub" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Post to GitHub" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fileIssue).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "This draft was filed or deleted. Reload.",
    );
    expect(dialog.textContent).not.toContain("Someone else edited");
  });

  it("does not file when the flush before filing hits a conflict", async () => {
    updateDraft.mockResolvedValue({ ok: false, reason: "conflict" });
    render(<IssueDraftEditor issue={issue} />);
    typeTitle("Edited");
    fireEvent.click(screen.getByRole("button", { name: "File on GitHub" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Post to GitHub" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fileIssue).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(
        "Someone else edited this draft. Reload to see their changes.",
      ).length,
    ).toBeGreaterThan(0);
  });
});
