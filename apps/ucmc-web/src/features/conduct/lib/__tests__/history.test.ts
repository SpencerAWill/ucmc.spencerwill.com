import { describe, expect, it } from "vitest";

import { historyLabel } from "#/features/conduct/lib/history";

describe("historyLabel", () => {
  it.each([
    ["conduct.record_created", { level: "note" }, "Record created"],
    [
      "conduct.record_created",
      { level: "note", scocState: "referred" },
      "Record created and referred to SCCS",
    ],
    [
      "conduct.record_updated",
      { fields: ["internalNotes"] },
      "Internal notes edited",
    ],
    ["conduct.referred", { from: "none", to: "referred" }, "Referred to SCCS"],
    [
      "conduct.sccs_outcome",
      { from: "referred", to: "returned" },
      "SCCS returned it to the club",
    ],
    [
      "conduct.sccs_outcome",
      { from: "referred", to: "sccs_sanctioned" },
      "SCCS sanctioned the member",
    ],
    ["conduct.lifted", { level: "warning" }, "Lifted"],
    ["conduct.lifted", { supersededBy: "crec_new" }, "Lifted by a correction"],
  ])("%s %j reads %s", (action, metadata, expected) => {
    expect(historyLabel(action, JSON.stringify(metadata))).toBe(expected);
  });

  it("falls back when the metadata is missing or unreadable", () => {
    expect(historyLabel("conduct.sccs_outcome", null)).toBe(
      "SCCS outcome recorded",
    );
    expect(historyLabel("conduct.sccs_outcome", "{not json")).toBe(
      "SCCS outcome recorded",
    );
    expect(
      historyLabel("conduct.sccs_outcome", JSON.stringify({ to: "bogus" })),
    ).toBe("SCCS outcome recorded");
  });

  it("shows an unknown action as is rather than dropping it", () => {
    expect(historyLabel("conduct.something_new", null)).toBe(
      "conduct.something_new",
    );
  });
});
