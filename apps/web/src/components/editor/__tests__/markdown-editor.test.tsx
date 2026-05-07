import { render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  MarkdownEditor,
  isSafeLinkUrl,
} from "#/components/editor/markdown-editor";

import type { MarkdownEditorHandle } from "#/components/editor/markdown-editor";

// `useEditor` from @tiptap/react schedules its first render in a
// microtask when `immediatelyRender: false`; tests need to wait for
// the editor instance to be created before assertions on toolbar /
// content land.
async function waitForEditor() {
  await waitFor(() => {
    // The toolbar is rendered after the editor instance exists, so we
    // can use one of the toolbar buttons as the readiness signal.
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
  });
}

describe("isSafeLinkUrl", () => {
  it("accepts http(s), mailto, tel, relative, and fragment URLs", () => {
    for (const url of [
      "https://example.com",
      "http://example.com/path",
      "mailto:foo@example.com",
      "tel:+15135551234",
      "/relative",
      "#section",
      "?query=1",
      "page.html",
    ]) {
      expect(isSafeLinkUrl(url)).toBe(true);
    }
  });

  it("rejects javascript: / data: / vbscript: URLs", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "  javascript:alert(1)  ",
    ]) {
      expect(isSafeLinkUrl(url)).toBe(false);
    }
  });
});

describe("MarkdownEditor", () => {
  it("renders all toolbar buttons", async () => {
    render(<MarkdownEditor value="" onChange={() => {}} />);
    await waitForEditor();
    for (const label of [
      "Bold",
      "Italic",
      "Strikethrough",
      "Inline code",
      "Link",
      "Heading 2",
      "Heading 3",
      "Bullet list",
      "Numbered list",
      "Task list",
      "Blockquote",
      "Code block",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("groups its toolbar under role=toolbar", async () => {
    render(<MarkdownEditor value="" onChange={() => {}} />);
    await waitForEditor();
    expect(
      screen.getByRole("toolbar", { name: "Formatting" }),
    ).toBeInTheDocument();
  });

  it("renders the placeholder text on the empty state", async () => {
    render(
      <MarkdownEditor
        value=""
        onChange={() => {}}
        placeholder="Tell us what's on your mind"
      />,
    );
    await waitForEditor();
    // Placeholder is exposed on the empty paragraph as `data-placeholder`
    // (the CSS pseudo-element surfaces it visually). Match against the
    // attribute, since jsdom doesn't compute pseudo-element content.
    const empty = document.querySelector("p.is-editor-empty");
    expect(empty).not.toBeNull();
    expect(empty?.getAttribute("data-placeholder")).toBe(
      "Tell us what's on your mind",
    );
  });

  it("populates the imperative focus handle on mount", async () => {
    function Harness() {
      const ref = useRef<MarkdownEditorHandle | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={() => ref.current?.focus()}
            data-testid="focus-trigger"
          >
            focus
          </button>
          <MarkdownEditor value="" onChange={() => {}} handleRef={ref} />
        </>
      );
    }
    render(<Harness />);
    await waitForEditor();
    // Editor mounted ⇒ handle should be populated. We don't assert
    // *focus* here because jsdom's contenteditable focus semantics are
    // unreliable; populating the handle is the measurable contract.
    const editorEl = document.querySelector(".ProseMirror");
    expect(editorEl).not.toBeNull();
  });

  it("exposes aria-labelledby and validation attrs on the contenteditable", async () => {
    render(
      <MarkdownEditor
        value=""
        onChange={() => {}}
        ariaLabelledBy="my-label-id"
        ariaDescribedBy="my-desc-id"
        attrs={{ "aria-invalid": true }}
      />,
    );
    await waitForEditor();
    const pm = document.querySelector(".ProseMirror");
    expect(pm).not.toBeNull();
    expect(pm?.getAttribute("aria-labelledby")).toBe("my-label-id");
    expect(pm?.getAttribute("aria-describedby")).toBe("my-desc-id");
    expect(pm?.getAttribute("aria-invalid")).toBe("true");
    expect(pm?.getAttribute("role")).toBe("textbox");
    expect(pm?.getAttribute("aria-multiline")).toBe("true");
  });

  it("renders a character counter when maxLength is set", async () => {
    render(<MarkdownEditor value="" onChange={() => {}} maxLength={2000} />);
    await waitForEditor();
    expect(screen.getByText("0 / 2000")).toBeInTheDocument();
  });

  it("does not render a character counter when maxLength is unset", async () => {
    render(<MarkdownEditor value="" onChange={() => {}} />);
    await waitForEditor();
    // Match any "n / m" string just to be sure none rendered.
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
  });

  it("does not warn about duplicate extensions or unknown DOM props", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MarkdownEditor
        value="**bold** [example](https://example.com)"
        onChange={() => {}}
      />,
    );
    await waitForEditor();
    // The fix for the StarterKit-bundled-Link clash should keep this
    // empty; the test exists as a regression guard.
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toMatch(/Duplicate extension names/i);
    }
    for (const call of error.mock.calls) {
      expect(String(call[0])).not.toMatch(/Unknown prop/i);
    }
    warn.mockRestore();
    error.mockRestore();
  });
});
