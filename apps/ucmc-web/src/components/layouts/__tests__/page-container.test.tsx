/**
 * The point of `PageContainer` is that the horizontal gutter is the same
 * on every page, so the text edge doesn't jump as you navigate. A new
 * tier that carries its own `px-*` would break that silently — nothing
 * else in the app would fail — so it's pinned here.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PageWidth } from "#/components/layouts/page-container";
import { PageContainer } from "#/components/layouts/page-container";

const WIDTHS: ReadonlyArray<PageWidth> = ["focused", "prose", "app", "wide"];

describe("PageContainer", () => {
  it.each(WIDTHS)("gives %s the shared horizontal gutter", (width) => {
    render(
      <PageContainer width={width}>
        <p>content</p>
      </PageContainer>,
    );

    const classes = screen.getByText("content").parentElement?.className ?? "";

    expect(classes).toContain("px-4");
    expect(classes).toContain("sm:px-6");
    // No tier may introduce a competing horizontal padding of its own.
    expect(classes).not.toMatch(/(?:^|\s)(?:sm:)?p-\d/);
  });

  it.each(WIDTHS)("gives %s its own measure", (width) => {
    render(
      <PageContainer width={width}>
        <p>content</p>
      </PageContainer>,
    );

    expect(screen.getByText("content").parentElement?.className).toMatch(
      /max-w-\S+/,
    );
  });

  /**
   * Content spacing arrives through `className`, and a page that has a
   * reason to override the measure should win deterministically — via
   * `twMerge`, not stylesheet order. Same reasoning as the tab bars.
   */
  it("lets className settle conflicts with the variant", () => {
    render(
      <PageContainer width="prose" className="max-w-3xl space-y-8">
        <p>content</p>
      </PageContainer>,
    );

    const classes = screen.getByText("content").parentElement?.className ?? "";

    expect(classes).toContain("max-w-3xl");
    expect(classes).not.toContain("max-w-2xl");
    expect(classes).toContain("space-y-8");
  });
});
