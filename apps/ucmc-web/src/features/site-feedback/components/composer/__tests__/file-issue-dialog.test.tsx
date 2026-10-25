import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileIssueDialog } from "#/features/site-feedback/components/composer/file-issue-dialog";

const fileIssue = vi.fn();
vi.mock("#/features/site-feedback/api/use-file-site-feedback-issue", () => ({
  useFileSiteFeedbackIssue: () => ({
    mutateAsync: fileIssue,
    isPending: false,
  }),
}));

beforeEach(() => {
  fileIssue.mockReset();
});

describe("FileIssueDialog", () => {
  it("shows the too_long message returned by the action", async () => {
    fileIssue.mockResolvedValue({
      ok: false,
      reason: "too_long",
      message: "The issue body is too long for GitHub.",
    });
    const user = userEvent.setup();
    render(
      <FileIssueDialog
        issueId="sfi_1"
        reportCount={3}
        repo="example/repo"
        disabled={false}
        onFiled={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "File on GitHub" }));
    expect(
      screen.getByText(/This posts 3 reports publicly to example\/repo/),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Post to GitHub" }));
    expect(
      await screen.findByText("The issue body is too long for GitHub."),
    ).toBeTruthy();
  });
});
