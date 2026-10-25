/**
 * What the site-feedback form sends. The page fields come from the
 * context recorded when the dialog opened, never from `window` at submit
 * time — the dialog covers the page, and on a phone the member may have
 * navigated underneath it.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedbackPageContext } from "#/components/feedback/feedback-launcher";
import { SiteFeedbackForm } from "#/features/site-feedback/components/site-feedback-form";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("#/features/site-feedback/api/use-submit-site-feedback", () => ({
  useSubmitSiteFeedback: () => ({ mutate }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// TipTap in jsdom is slow and beside the point; a textarea speaks the
// same value/onChange contract.
vi.mock("#/components/editor/markdown-editor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    ariaLabelledBy,
  }: {
    value: string;
    onChange: (v: string) => void;
    ariaLabelledBy?: string;
  }) => (
    <textarea
      aria-labelledby={ariaLabelledBy}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const CONTEXT: FeedbackPageContext = {
  pageUrl: "https://ucmc.example/gear?tab=loans",
  userAgent: "TestAgent/1.0",
  screenshot: null,
};

async function fillGeneral() {
  await userEvent.click(screen.getByRole("tab", { name: "General" }));
  await userEvent.type(screen.getByLabelText("Title"), "A title");
  await userEvent.type(await screen.findByLabelText("Details"), "Some body");
}

describe("SiteFeedbackForm", () => {
  beforeEach(() => {
    mutate.mockReset();
    window.history.pushState({}, "", "/somewhere-else");
  });

  it("submits the pageUrl and userAgent from pageContext, not the current location", async () => {
    render(<SiteFeedbackForm pageContext={CONTEXT} />);
    await fillGeneral();
    await userEvent.click(
      screen.getByRole("button", { name: "Send feedback" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      kind: "general",
      pageUrl: CONTEXT.pageUrl,
      userAgent: CONTEXT.userAgent,
    });
  });

  it("calls onSubmitted after a successful submit", async () => {
    mutate.mockImplementation((_data, opts: { onSuccess: () => void }) =>
      opts.onSuccess(),
    );
    const onSubmitted = vi.fn();
    render(
      <SiteFeedbackForm pageContext={CONTEXT} onSubmitted={onSubmitted} />,
    );
    await fillGeneral();
    await userEvent.click(
      screen.getByRole("button", { name: "Send feedback" }),
    );
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
  });

  describe("screenshot", () => {
    const WITH_SHOT: FeedbackPageContext = {
      ...CONTEXT,
      screenshot: {
        dataUrl: "data:image/webp;base64,UklGRgAAAABXRUJQ",
        contentType: "image/webp",
        bytes: 12,
      },
    };

    function checkbox() {
      return screen.getByRole("checkbox", { name: "Include screenshot" });
    }

    it("Include screenshot is checked by default for Bug and unchecked for Feature and General", async () => {
      render(<SiteFeedbackForm pageContext={WITH_SHOT} />);
      expect(checkbox()).toBeChecked();
      await userEvent.click(screen.getByRole("tab", { name: "Feature" }));
      expect(checkbox()).not.toBeChecked();
      await userEvent.click(screen.getByRole("tab", { name: "General" }));
      expect(checkbox()).not.toBeChecked();
      await userEvent.click(screen.getByRole("tab", { name: "Bug" }));
      expect(checkbox()).toBeChecked();
    });

    it("once the member toggles it, switching kind keeps their choice", async () => {
      render(<SiteFeedbackForm pageContext={WITH_SHOT} />);
      await userEvent.click(checkbox());
      expect(checkbox()).not.toBeChecked();
      await userEvent.click(screen.getByRole("tab", { name: "General" }));
      await userEvent.click(screen.getByRole("tab", { name: "Bug" }));
      expect(checkbox()).not.toBeChecked();
    });

    it("ticked on a general report, the submission carries the screenshot", async () => {
      render(<SiteFeedbackForm pageContext={WITH_SHOT} />);
      await fillGeneral();
      await userEvent.click(checkbox());
      await userEvent.click(
        screen.getByRole("button", { name: "Send feedback" }),
      );
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
      expect(mutate.mock.calls[0]?.[0]).toMatchObject({
        screenshotDataUrl: WITH_SHOT.screenshot?.dataUrl,
      });
    });

    it("unticked, the submission carries no screenshotDataUrl", async () => {
      render(<SiteFeedbackForm pageContext={WITH_SHOT} />);
      await fillGeneral();
      expect(checkbox()).not.toBeChecked();
      await userEvent.click(
        screen.getByRole("button", { name: "Send feedback" }),
      );
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
      expect(mutate.mock.calls[0]?.[0]).not.toHaveProperty("screenshotDataUrl");
    });

    it("no screenshot in pageContext renders no checkbox", () => {
      render(<SiteFeedbackForm pageContext={CONTEXT} />);
      expect(
        screen.queryByRole("checkbox", { name: "Include screenshot" }),
      ).toBeNull();
      expect(screen.queryByRole("img")).toBeNull();
    });

    it("shows the thumbnail and the privacy helper text", () => {
      render(<SiteFeedbackForm pageContext={WITH_SHOT} />);
      expect(
        screen.getByText(
          "Visible only to you and site maintainers. Never posted publicly.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: /screenshot/i }).getAttribute("src"),
      ).toBe(WITH_SHOT.screenshot?.dataUrl);
    });
  });
});
