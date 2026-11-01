import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecordsTable } from "#/features/conduct/components/records-table";
import type { ConductRecordSummary } from "#/features/conduct/server/record-fns";
import { listConductRecordsFn } from "#/features/conduct/server/record-fns";
import { renderWithRouter } from "#/test-support/router-harness";

vi.mock("#/features/conduct/server/record-fns", () => ({
  listConductRecordsFn: vi.fn(),
}));

function record(
  overrides: Partial<ConductRecordSummary> = {},
): ConductRecordSummary {
  return {
    publicId: "crec_1",
    level: "warning",
    subjectName: "Sam Subject",
    subjectPublicId: "usr_1",
    startsOn: Temporal.PlainDate.from("2026-10-01"),
    endsOn: null,
    scocState: "none",
    liftedAt: null,
    noticeSentAt: Temporal.Instant.from("2026-10-01T15:00:00Z"),
    createdAt: Temporal.Instant.from("2026-10-01T15:00:00Z"),
    ...overrides,
  };
}

function renderTable() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithRouter(
    <QueryClientProvider client={client}>
      <RecordsTable />
    </QueryClientProvider>,
  );
}

// Both trees render (CSS picks one), so read the desktop table only.
async function table() {
  return within(await screen.findByRole("table"));
}

describe("RecordsTable", () => {
  beforeEach(() => {
    vi.mocked(listConductRecordsFn).mockReset();
  });

  it("names each record's state as filed", async () => {
    vi.mocked(listConductRecordsFn).mockResolvedValue([
      record({ publicId: "crec_open", subjectName: "Open Member" }),
      record({
        publicId: "crec_lifted",
        subjectName: "Lifted Member",
        liftedAt: Temporal.Instant.from("2026-10-05T15:00:00Z"),
      }),
      record({
        publicId: "crec_ref",
        subjectName: "Referred Member",
        level: "note",
        scocState: "referred",
        noticeSentAt: null,
      }),
    ]);
    renderTable();
    const rows = (await table()).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Open")).toBeVisible();
    expect(within(rows[1]).getByText("Lifted")).toBeVisible();
    expect(within(rows[2]).getByText("Referred to SCCS")).toBeVisible();
  });

  it("flags a notice that never went out, but not for a note or a lifted record", async () => {
    vi.mocked(listConductRecordsFn).mockResolvedValue([
      record({
        publicId: "crec_unsent",
        subjectName: "Unsent",
        noticeSentAt: null,
      }),
      record({
        publicId: "crec_note",
        subjectName: "Note",
        level: "note",
        noticeSentAt: null,
      }),
      record({
        publicId: "crec_gone",
        subjectName: "Lifted",
        noticeSentAt: null,
        liftedAt: Temporal.Instant.from("2026-10-05T15:00:00Z"),
      }),
    ]);
    renderTable();
    const rows = (await table()).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Notice not sent")).toBeVisible();
    expect(within(rows[1]).queryByText("Notice not sent")).toBeNull();
    expect(within(rows[2]).queryByText("Notice not sent")).toBeNull();
  });

  it("sends the chosen level and status to the server", async () => {
    const user = userEvent.setup();
    vi.mocked(listConductRecordsFn).mockResolvedValue([record()]);
    renderTable();
    await table();

    await user.click(
      within(screen.getByRole("radiogroup", { name: "Level" })).getByRole(
        "radio",
        {
          name: "Suspension",
        },
      ),
    );
    await user.click(
      within(screen.getByRole("radiogroup", { name: "Status" })).getByRole(
        "radio",
        {
          name: "Referred",
        },
      ),
    );

    expect(vi.mocked(listConductRecordsFn)).toHaveBeenLastCalledWith({
      data: { level: "suspension", referred: true },
    });
  });

  it("keeps a filter set when its chip is pressed again", async () => {
    const user = userEvent.setup();
    vi.mocked(listConductRecordsFn).mockResolvedValue([record()]);
    renderTable();
    await table();
    const lifted = within(
      screen.getByRole("radiogroup", { name: "Status" }),
    ).getByRole("radio", { name: "Lifted" });

    await user.click(lifted);
    await user.click(lifted);

    expect(lifted).toBeChecked();
    expect(vi.mocked(listConductRecordsFn)).toHaveBeenLastCalledWith({
      data: { lifted: true },
    });
  });
});
