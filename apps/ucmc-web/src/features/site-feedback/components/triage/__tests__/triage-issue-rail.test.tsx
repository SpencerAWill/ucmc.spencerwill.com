import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TriageIssueRail } from "#/features/site-feedback/components/triage/triage-issue-rail";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a href="#link" {...rest}>
      {children}
    </a>
  ),
}));
const syncState = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError },
}));
vi.mock("#/features/site-feedback/api/use-sync-site-feedback-issues", () => ({
  useSyncSiteFeedbackIssues: () => syncState,
}));

const draft = {
  id: "sfi_1",
  state: "draft" as const,
  title: "Fix the thing",
  githubNumber: null,
  githubUrl: null,
  reportCount: 2,
  unpostedCount: 2,
  updatedAt: Temporal.Instant.from("2026-10-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  syncState.isError = false;
  syncState.error = null;
});

describe("TriageIssueRail", () => {
  it("explains and disables sync when GitHub is not configured", () => {
    render(
      <TriageIssueRail
        drafts={[]}
        openIssues={[]}
        githubConfigured={false}
        lastSyncedAt={null}
      />,
    );
    expect(
      screen.getByText("GitHub isn't configured, so filing and sync are off"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync now/i })).toBeDisabled();
  });

  it("shows Never synced when there is no sync time", () => {
    render(
      <TriageIssueRail
        drafts={[]}
        openIssues={[]}
        githubConfigured
        lastSyncedAt={null}
      />,
    );
    expect(screen.getByText("Never synced")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sync now/i })).toBeEnabled();
  });

  it("lists drafts with their report counts", () => {
    render(
      <TriageIssueRail
        drafts={[draft]}
        openIssues={[]}
        githubConfigured
        lastSyncedAt={Temporal.Instant.from("2026-10-20T00:00:00Z")}
      />,
    );
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    expect(screen.getByText("2 reports")).toBeInTheDocument();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
  });

  it("surfaces a not_configured sync result", async () => {
    syncState.mutate.mockImplementation(
      (
        _v: undefined,
        o: { onSuccess: (r: { ok: false; reason: string }) => void },
      ) => {
        o.onSuccess({ ok: false, reason: "not_configured" });
      },
    );
    const user = userEvent.setup();
    render(
      <TriageIssueRail
        drafts={[]}
        openIssues={[]}
        githubConfigured
        lastSyncedAt={null}
      />,
    );
    await user.click(screen.getByRole("button", { name: /sync now/i }));
    expect(toastError).toHaveBeenCalledWith("GitHub isn't configured.");
  });

  it("shows an alert when the sync mutation errors", () => {
    syncState.isError = true;
    syncState.error = new Error("GitHub said no");
    render(
      <TriageIssueRail
        drafts={[]}
        openIssues={[]}
        githubConfigured
        lastSyncedAt={null}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("GitHub said no");
  });
});
