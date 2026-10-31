import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TriageActions } from "#/features/conduct/components/triage-actions";
import type { ConductReportSummary } from "#/features/conduct/server/report-fns";

const getSubject = vi.hoisted(() => vi.fn());
vi.mock("#/features/conduct/server/record-fns", () => ({
  createConductRecordFn: vi.fn(),
  getConductSubjectFn: getSubject,
  searchConductSubjectsFn: vi.fn(async () => []),
  listConductRecordsFn: vi.fn(async () => []),
}));
vi.mock("#/features/conduct/server/report-fns", () => ({
  acceptConductReportFn: vi.fn(),
  dismissConductReportFn: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const REPORT: ConductReportSummary = {
  id: "rep1",
  reporterName: "Rita",
  subjectName: "Sam Subject",
  subjectPublicId: "pub_sam",
  subjectDescription: null,
  occurredOn: Temporal.PlainDate.from("2026-10-01"),
  location: null,
  body: "x",
  possibleScoc: false,
  status: "new",
  triagedAt: null,
  dismissReason: null,
};

async function startRecord(report: ConductReportSummary) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TriageActions report={report} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Start a record" }));
}

describe("TriageActions start a record", () => {
  it("prefills the member a named report is about", async () => {
    getSubject.mockResolvedValue({
      userId: "user_sam",
      publicId: "pub_sam",
      fullName: "Sam Subject",
    });
    await startRecord(REPORT);
    expect(
      await screen.findByRole("combobox", { name: "Member: Sam Subject" }),
    ).toBeVisible();
    expect(getSubject).toHaveBeenCalledWith({ data: { publicId: "pub_sam" } });
  });

  it("says so when the named member is no longer available", async () => {
    getSubject.mockResolvedValue(null);
    await startRecord(REPORT);
    expect(await screen.findByText(/no longer available/)).toBeInTheDocument();
    expect(screen.queryByText(/does not name a member/)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
