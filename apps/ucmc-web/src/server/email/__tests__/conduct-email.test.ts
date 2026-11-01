import { describe, expect, it } from "vitest";

import { conductNoticeEmail } from "#/server/email/conduct-email";

describe("conductNoticeEmail", () => {
  it("is the statement, the dates and the appeal line", () => {
    const m = conductNoticeEmail({
      to: "a@example.com",
      level: "suspension",
      statement: "You are suspended.",
      lifted: false,
      startsOn: Temporal.PlainDate.from("2026-11-01"),
      endsOn: Temporal.PlainDate.from("2026-12-01"),
    });
    expect(m.kind).toBe("conduct.notice");
    expect(m.to).toBe("a@example.com");
    expect(m.text).toContain("You are suspended.");
    expect(m.text).toContain("Starts: 2026-11-01");
    expect(m.text).toContain("Ends: 2026-12-01");
    expect(m.text).toContain("appeal in writing within two weeks");
  });

  it("does not repeat dates or the appeal line the statement carries", () => {
    const statement = "Effective 2026-11-01. You may appeal within two weeks.";
    const m = conductNoticeEmail({
      level: "warning",
      statement,
      lifted: false,
      startsOn: Temporal.PlainDate.from("2026-11-01"),
    });
    expect(m.text).toBe(`${statement}\n`);
  });

  it("says a sanction was lifted and nothing else", () => {
    const m = conductNoticeEmail({
      to: "a@example.com",
      level: "termination",
      statement: "ignored statement",
      lifted: true,
    });
    expect(m.text).toContain("lifted");
    expect(m.text).toContain("termination");
    expect(m.text).not.toContain("ignored statement");
  });

  it("says a correction replaces an earlier notice, first", () => {
    const m = conductNoticeEmail({
      level: "warning",
      statement: "You are warned. You may appeal.",
      lifted: false,
      corrects: true,
    });
    expect(m.subject).toBe(
      "Corrected notice from the UCMC Executive Committee: warning",
    );
    expect(m.text).toBe(
      "This notice corrects an earlier one. The earlier notice no longer applies.\n\nYou are warned. You may appeal.\n",
    );
  });
});
