import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "#/components/markdown/markdown-content";

describe("MarkdownContent", () => {
  it("renders bold and italic marks", () => {
    render(<MarkdownContent>{"**bold** and *italic*"}</MarkdownContent>);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders headings", () => {
    render(<MarkdownContent>{"## A heading"}</MarkdownContent>);
    expect(
      screen.getByRole("heading", { level: 2, name: "A heading" }),
    ).toBeInTheDocument();
  });

  it("renders bullet lists", () => {
    render(<MarkdownContent>{"- one\n- two"}</MarkdownContent>);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });

  it("renders GFM task lists with checkboxes", () => {
    render(<MarkdownContent>{"- [ ] todo\n- [x] done"}</MarkdownContent>);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
  });

  it("opens external links in a new tab with rel=noopener", () => {
    render(
      <MarkdownContent>{"[example](https://example.com)"}</MarkdownContent>,
    );
    const link = screen.getByRole("link", { name: "example" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("does not render raw HTML (XSS-safe)", () => {
    render(
      <MarkdownContent>{"<script>alert(1)</script>safe"}</MarkdownContent>,
    );
    // react-markdown escapes raw HTML by default; the script tag should
    // not be parsed as a real element.
    expect(document.querySelector("script")).toBeNull();
  });
});
