import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TriageSelectionToolbar } from "#/features/site-feedback/components/triage/triage-selection-toolbar";

const createDraft = vi.fn();
const setDisposition = vi.fn();
const link = vi.fn();
const attach = vi.fn();
const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "#/features/site-feedback/api/use-create-site-feedback-issue-draft",
  () => ({
    useCreateSiteFeedbackIssueDraft: () => ({
      mutateAsync: createDraft,
      isPending: false,
    }),
  }),
);
vi.mock(
  "#/features/site-feedback/api/use-set-site-feedback-disposition",
  () => ({
    useSetSiteFeedbackDisposition: () => ({
      mutateAsync: setDisposition,
      isPending: false,
    }),
  }),
);
vi.mock("#/features/site-feedback/api/use-link-site-feedback", () => ({
  useLinkSiteFeedback: () => ({ mutateAsync: link, isPending: false }),
}));
vi.mock(
  "#/features/site-feedback/api/use-attach-site-feedback-to-github-issue",
  () => ({
    useAttachSiteFeedbackToGithubIssue: () => ({
      mutateAsync: attach,
      isPending: false,
    }),
  }),
);

const baseProps = {
  drafts: [],
  openIssues: [],
  githubConfigured: true,
  onDone: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TriageSelectionToolbar", () => {
  it("renders nothing with no selection", () => {
    render(<TriageSelectionToolbar {...baseProps} selectedIds={[]} />);
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /new draft/i }),
    ).not.toBeInTheDocument();
  });

  it("creates a draft from both ids, then navigates to the composer", async () => {
    createDraft.mockResolvedValue({ id: "sfi_1" });
    const user = userEvent.setup();
    render(<TriageSelectionToolbar {...baseProps} selectedIds={["a", "b"]} />);

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /new draft/i }));

    await waitFor(() => {
      expect(createDraft).toHaveBeenCalledWith({ feedbackIds: ["a", "b"] });
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: "/feedback/site/triage/issues/$issueId",
        params: { issueId: "sfi_1" },
      });
    });
  });

  it("marks the selection won't fix", async () => {
    setDisposition.mockResolvedValue({ updated: 2 });
    const user = userEvent.setup();
    render(<TriageSelectionToolbar {...baseProps} selectedIds={["a", "b"]} />);

    await user.click(screen.getByRole("button", { name: /won.t fix/i }));

    await waitFor(() => {
      expect(setDisposition).toHaveBeenCalledWith({
        ids: ["a", "b"],
        disposition: "wont_fix",
      });
    });
  });

  it("marks the selection duplicate", async () => {
    setDisposition.mockResolvedValue({ updated: 1 });
    const user = userEvent.setup();
    render(<TriageSelectionToolbar {...baseProps} selectedIds={["a"]} />);

    await user.click(screen.getByRole("button", { name: /duplicate/i }));

    await waitFor(() => {
      expect(setDisposition).toHaveBeenCalledWith({
        ids: ["a"],
        disposition: "duplicate",
      });
    });
  });

  it("offers the typed GitHub number and attaches to it", async () => {
    attach.mockResolvedValue({ ok: true, issueId: "sfi_9" });
    const user = userEvent.setup();
    render(<TriageSelectionToolbar {...baseProps} selectedIds={["a", "b"]} />);

    await user.click(screen.getByRole("button", { name: /add to/i }));
    await user.type(screen.getByPlaceholderText(/github #/i), "#123");

    const option = await screen.findByText("GitHub issue #123");
    expect(option).toBeVisible();
    await user.click(option);

    await waitFor(() => {
      expect(attach).toHaveBeenCalledWith({
        number: 123,
        feedbackIds: ["a", "b"],
      });
    });
  });
});
