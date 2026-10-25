import { describe, expect, it } from "vitest";

import {
  GITHUB_BODY_LIMIT,
  composeIssueBody,
  composeReportsComment,
  defaultLabelsFor,
  issueMarker,
  quotedReportFor,
} from "#/features/site-feedback/server/issue-format";

const base = {
  kind: "bug" as const,
  title: "Login broken",
  body: "Sign-in is offscreen.",
  pageUrl: "https://ucmc.example/trips/abc" as string | null,
  userAgent: "Mozilla/5.0" as string | null,
  createdByPublicId: "usr_abc123" as string | null,
  createdAt: Temporal.Instant.from("2026-10-25T02:30:00Z"),
  hasScreenshot: false,
};

describe("quotedReportFor", () => {
  it("renders the exact details block, dated in club time", () => {
    expect(quotedReportFor(base)).toBe(
      [
        "<details><summary>🐞 Login broken: member usr_abc123, 2026-10-24</summary>",
        "",
        "Sign-in is offscreen.",
        "",
        "**Page:** `/trips/abc` · **Browser:** Mozilla/5.0",
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it('adds "Screenshot attached (visible in triage)." when hasScreenshot', () => {
    expect(quotedReportFor({ ...base, hasScreenshot: true })).toBe(
      [
        "<details><summary>🐞 Login broken: member usr_abc123, 2026-10-24</summary>",
        "",
        "Sign-in is offscreen.",
        "",
        "**Page:** `/trips/abc` · **Browser:** Mozilla/5.0",
        "",
        "Screenshot attached (visible in triage).",
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it("uses the kind's emoji", () => {
    expect(quotedReportFor({ ...base, kind: "feature" })).toContain("✨ ");
    expect(quotedReportFor({ ...base, kind: "general" })).toContain("💬 ");
  });

  it("renders a null publicId as (deleted)", () => {
    const out = quotedReportFor({ ...base, createdByPublicId: null });
    expect(out).toContain("member (deleted), 2026-10-24");
  });

  it("omits the Page and Browser parts when null", () => {
    const out = quotedReportFor({ ...base, pageUrl: null, userAgent: null });
    expect(out).toBe(
      [
        "<details><summary>🐞 Login broken: member usr_abc123, 2026-10-24</summary>",
        "",
        "Sign-in is offscreen.",
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it("keeps only the part that is present", () => {
    expect(quotedReportFor({ ...base, userAgent: null })).toContain(
      "**Page:** `/trips/abc`\n",
    );
    expect(quotedReportFor({ ...base, pageUrl: null })).toContain(
      "**Browser:** Mozilla/5.0\n",
    );
  });

  it("omits Page when the url does not parse", () => {
    const out = quotedReportFor({ ...base, pageUrl: "not a url" });
    expect(out).not.toContain("**Page:**");
    expect(out).toContain("**Browser:** Mozilla/5.0");
  });

  it("truncates the user agent to 120 characters with an ellipsis", () => {
    const out = quotedReportFor({ ...base, userAgent: "x".repeat(200) });
    expect(out).toContain(`**Browser:** ${"x".repeat(120)}…\n`);
    const exact = quotedReportFor({ ...base, userAgent: "y".repeat(120) });
    expect(exact).toContain(`**Browser:** ${"y".repeat(120)}\n`);
  });

  it("puts no email-shaped text in the summary line", () => {
    const summary = quotedReportFor(base).split("\n")[0];
    expect(summary).not.toContain("@");
  });
});

describe("quotedReportFor defuses member text", () => {
  const ZWSP = "​";
  const quoted = (over: Partial<typeof base>) =>
    quotedReportFor({ ...base, pageUrl: null, userAgent: null, ...over });

  it("breaks an @mention in the title and body", () => {
    expect(quoted({ title: "Ping @octocat", body: "cc @team-a now" })).toBe(
      [
        `<details><summary>🐞 Ping @${ZWSP}octocat: member usr_abc123, 2026-10-24</summary>`,
        "",
        `cc @${ZWSP}team-a now`,
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it("breaks a #123 issue reference", () => {
    expect(quoted({ title: "Like #12", body: "see #3, not # 4 or #x" })).toBe(
      [
        `<details><summary>🐞 Like #${ZWSP}12: member usr_abc123, 2026-10-24</summary>`,
        "",
        `see #${ZWSP}3, not # 4 or #x`,
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it("escapes < so a body cannot close the details block", () => {
    expect(quoted({ title: "<b>x</b>", body: "</details> <img src=x>" })).toBe(
      [
        "<details><summary>🐞 &lt;b>x&lt;/b>: member usr_abc123, 2026-10-24</summary>",
        "",
        "&lt;/details> &lt;img src=x>",
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it("replaces email addresses", () => {
    expect(
      quoted({
        title: "From alice@example.com",
        body: "Mail bob.smith+x@mail.uc.edu or @ nobody",
      }),
    ).toBe(
      [
        "<details><summary>🐞 From [email removed]: member usr_abc123, 2026-10-24</summary>",
        "",
        "Mail [email removed] or @ nobody",
        "",
        "</details>",
      ].join("\n"),
    );
  });

  it("defuses the user agent too", () => {
    expect(quoted({ userAgent: "Bot/1.0 (@ops; #7; <x>)" })).toContain(
      `**Browser:** Bot/1.0 (@${ZWSP}ops; #${ZWSP}7; &lt;x>)\n`,
    );
  });
});

describe("issueMarker", () => {
  it("wraps the id in an HTML comment", () => {
    expect(issueMarker("sfi_1")).toBe("<!-- ucmc:sfi_1 -->");
  });
});

describe("composeIssueBody", () => {
  it("assembles summary, reports, footer and marker", () => {
    expect(
      composeIssueBody({
        issueId: "sfi_1",
        summaryMd: "Summary",
        reports: ["R1", "R2"],
      }),
    ).toBe(
      "Summary\n\n## Reports (2)\n\nR1\n\nR2\n\n---\n_Collected from UCMC site feedback. Reports are attributed by opaque member id only._\n<!-- ucmc:sfi_1 -->",
    );
  });
});

describe("composeReportsComment", () => {
  it("assembles the heading, reports and footer", () => {
    expect(composeReportsComment(["R1", "R2", "R3"])).toBe(
      "## More reports (3)\n\nR1\n\nR2\n\nR3\n\n---\n_Linked from UCMC site-feedback triage._",
    );
  });
});

describe("defaultLabelsFor", () => {
  it("maps kinds in order and always adds feedback", () => {
    expect(defaultLabelsFor(["bug"])).toEqual(["bug", "feedback"]);
    expect(defaultLabelsFor(["feature"])).toEqual(["enhancement", "feedback"]);
    expect(defaultLabelsFor(["general"])).toEqual(["feedback"]);
  });

  it("dedupes and keeps bug, enhancement, feedback order", () => {
    expect(
      defaultLabelsFor(["feature", "bug", "feature", "bug", "general"]),
    ).toEqual(["bug", "enhancement", "feedback"]);
  });
});

describe("GITHUB_BODY_LIMIT", () => {
  it("leaves headroom under GitHub's 65,536", () => {
    expect(GITHUB_BODY_LIMIT).toBe(65_000);
  });
});
