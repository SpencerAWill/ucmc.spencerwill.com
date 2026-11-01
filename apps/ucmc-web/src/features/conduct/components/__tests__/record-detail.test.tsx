import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecordDetail } from "#/features/conduct/components/record-detail";
import type { ConductRecordDetail } from "#/features/conduct/server/record-fns";
import { renderWithRouter } from "#/test-support/router-harness";

vi.mock("#/features/conduct/server/record-fns", () => ({
  updateConductRecordFn: vi.fn(),
  referConductRecordFn: vi.fn(),
  recordSccsOutcomeFn: vi.fn(),
  liftConductRecordFn: vi.fn(),
  getCorrectionDraftFn: vi.fn(async () => null),
}));

function detail(
  overrides: Partial<ConductRecordDetail> = {},
): ConductRecordDetail {
  return {
    publicId: "crec_1",
    level: "warning",
    subjectName: "Sam Subject",
    subjectPublicId: "pub_sam",
    memberStatement: "A statement.",
    internalNotes: null,
    startsOn: Temporal.PlainDate.from("2026-10-01"),
    endsOn: null,
    scocState: "none",
    referredOn: null,
    referredByName: null,
    sccsOutcomeNote: null,
    voteHeldOn: null,
    votesFor: null,
    votesAgainst: null,
    votesAbstain: null,
    committeeSize: null,
    priorWarningPublicId: null,
    warningSkipped: false,
    supersedesPublicId: null,
    supersededByPublicId: null,
    liftedAt: null,
    liftedByName: null,
    liftReason: null,
    appealOutcome: null,
    noticeSentAt: null,
    createdByName: "Pat President",
    createdAt: Temporal.Instant.from("2026-10-01T12:00:00Z"),
    updatedAt: Temporal.Instant.from("2026-10-01T12:00:00Z"),
    retainUntil: null,
    reports: [],
    history: [],
    ...overrides,
  };
}

async function renderDetail(record: ConductRecordDetail, canManage = true) {
  const queryClient = new QueryClient();
  return renderWithRouter(
    <QueryClientProvider client={queryClient}>
      <RecordDetail record={record} canManage={canManage} />
    </QueryClientProvider>,
  );
}

describe("RecordDetail", () => {
  it("links the subject to their member page", async () => {
    await renderDetail(detail());
    expect(screen.getByRole("link", { name: "Sam Subject" })).toHaveAttribute(
      "href",
      "/members/pub_sam",
    );
  });

  it("shows the snapshot name as plain text once the account is gone", async () => {
    await renderDetail(detail({ subjectPublicId: null }));
    expect(screen.getByText("Sam Subject")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sam Subject" })).toBeNull();
  });

  it("shows a lifted record as lifted, with the reason and no lift action", async () => {
    await renderDetail(
      detail({
        liftedAt: Temporal.Instant.from("2026-10-20T12:00:00Z"),
        liftedByName: "Pat President",
        liftReason: "Appeal upheld.",
      }),
    );
    expect(screen.getAllByText("Lifted").length).toBeGreaterThan(0);
    expect(screen.getByText("Appeal upheld.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lift" })).toBeNull();
  });

  it("flags a warning whose notice was not sent, and not a note", async () => {
    const first = await renderDetail(detail({ level: "warning" }));
    expect(screen.getByText("Notice not sent")).toBeInTheDocument();
    first.unmount();
    const second = await renderDetail(
      detail({
        level: "warning",
        noticeSentAt: Temporal.Instant.from("2026-10-20T12:00:00Z"),
      }),
    );
    expect(screen.queryByText("Notice not sent")).toBeNull();
    second.unmount();
    await renderDetail(detail({ level: "note" }));
    expect(screen.queryByText("Notice not sent")).toBeNull();
  });

  it("hides manager controls from a viewer", async () => {
    await renderDetail(detail(), false);
    expect(screen.queryByRole("button", { name: "Lift" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit notes" })).toBeNull();
  });
});

describe("LiftDialog appeal field", () => {
  it("is asked for on a termination only", async () => {
    const { userEvent } = await import("@testing-library/user-event").then(
      (m) => ({ userEvent: m.default }),
    );
    const user = userEvent.setup();
    const first = await renderDetail(detail({ level: "termination" }));
    await user.click(screen.getByRole("button", { name: "Lift" }));
    expect(screen.getByLabelText(/Appeal outcome/)).toBeInTheDocument();
    first.unmount();
    await renderDetail(detail({ level: "warning" }));
    await user.click(screen.getByRole("button", { name: "Lift" }));
    expect(screen.queryByLabelText(/Appeal outcome/)).toBeNull();
  });
});

describe("LiftDialog reason field", () => {
  it("tells the officer the member can see the reason in their export", async () => {
    const { userEvent } = await import("@testing-library/user-event").then(
      (m) => ({ userEvent: m.default }),
    );
    const user = userEvent.setup();
    await renderDetail(detail({ level: "warning" }));
    await user.click(screen.getByRole("button", { name: "Lift" }));
    expect(
      screen.getByLabelText("Reason", { selector: "textarea" }),
    ).toHaveAccessibleDescription(
      "The member can see this reason in their data export.",
    );
  });

  it("offers Correct on a sent or active sanction, to managers only", async () => {
    const { unmount } = await renderDetail(
      detail({
        liftedAt: Temporal.Instant.from("2026-10-05T12:00:00Z"),
        liftReason: "Appeal upheld",
        noticeSentAt: Temporal.Instant.from("2026-10-01T12:00:00Z"),
      }),
    );
    expect(screen.getByRole("button", { name: "Correct" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Lift" })).toBeNull();
    unmount();

    const viewer = await renderDetail(detail(), false);
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
    viewer.unmount();

    const lifted = await renderDetail(
      detail({ liftedAt: Temporal.Instant.from("2026-10-05T12:00:00Z") }),
    );
    // Lifted before its notice went: nothing the member holds to correct.
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
    lifted.unmount();

    await renderDetail(detail({ level: "note", memberStatement: null }));
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
  });

  it("links a correction both ways and offers no second correction", async () => {
    const { unmount } = await renderDetail(
      detail({ supersededByPublicId: "crec_new" }),
    );
    expect(
      screen.getByRole("link", { name: "View the correction" }),
    ).toHaveAttribute("href", "/conduct/crec_new");
    expect(screen.queryByRole("button", { name: "Correct" })).toBeNull();
    unmount();

    await renderDetail(detail({ supersedesPublicId: "crec_old" }));
    expect(
      screen.getByRole("link", { name: "View the corrected record" }),
    ).toHaveAttribute("href", "/conduct/crec_old");
  });
});
