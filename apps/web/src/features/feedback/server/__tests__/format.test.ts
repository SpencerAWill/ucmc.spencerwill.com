import { describe, expect, it } from "vitest";

import { composeFeedbackBody } from "#/features/feedback/server/format";

describe("composeFeedbackBody", () => {
  it("returns the trimmed body verbatim for general feedback", () => {
    const body = composeFeedbackBody({
      kind: "general",
      title: "Hi",
      body: "  thanks for the new look  ",
    });
    expect(body).toBe("thanks for the new look");
  });

  it("renders the bug template sections in template order", () => {
    const body = composeFeedbackBody({
      kind: "bug",
      title: "Login broken on iOS",
      bugDescription: "Sign-in button is offscreen.",
      stepsToReproduce: "1. Open on iPhone\n2. Tap Sign in",
      expectedBehavior: "Sign-in button should be visible.",
      additionalContext: "",
      userAgent: "Mozilla/5.0 (iPhone)",
    });

    // Sections appear in template order; empty optional sections are
    // omitted; userAgent gets surfaced as a "Browser / user agent" line.
    expect(body).toBe(
      [
        "**Describe the bug**",
        "",
        "Sign-in button is offscreen.",
        "",
        "**Steps to reproduce**",
        "",
        "1. Open on iPhone\n2. Tap Sign in",
        "",
        "**Expected behavior**",
        "",
        "Sign-in button should be visible.",
        "",
        "**Browser / user agent**",
        "",
        "Mozilla/5.0 (iPhone)",
      ].join("\n"),
    );
    expect(body).not.toContain("**Additional context**");
  });

  it("includes the optional bug additional-context section when present", () => {
    const body = composeFeedbackBody({
      kind: "bug",
      title: "x",
      bugDescription: "a",
      stepsToReproduce: "b",
      expectedBehavior: "c",
      additionalContext: "Related to issue #42",
    });
    expect(body).toContain("**Additional context**");
    expect(body).toContain("Related to issue #42");
  });

  it("renders the feature template sections in template order", () => {
    const body = composeFeedbackBody({
      kind: "feature",
      title: "Dark mode",
      problem: "Hard to read at night.",
      proposedSolution: "Add a theme toggle.",
      alternatives: "OS-level dark mode is too coarse.",
      additionalContext: "",
    });

    expect(body).toBe(
      [
        "**Is your feature request related to a problem?**",
        "",
        "Hard to read at night.",
        "",
        "**Describe the solution you'd like**",
        "",
        "Add a theme toggle.",
        "",
        "**Describe alternatives you've considered**",
        "",
        "OS-level dark mode is too coarse.",
      ].join("\n"),
    );
  });
});
