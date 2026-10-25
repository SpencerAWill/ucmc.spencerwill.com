/**
 * The "Send feedback" dialog's step logic. The two forms are stubbed:
 * what's under test is which form appears, what page context reaches
 * it, and that the context recorded at open survives moving between
 * steps until the dialog closes.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FeedbackLauncherProvider,
  useFeedbackLauncher,
} from "#/components/feedback/feedback-launcher";
import type {
  CapturedScreenshot,
  FeedbackPageContext,
} from "#/components/feedback/feedback-launcher";
import { FeedbackDialog } from "#/components/layouts/feedback-dialog";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

vi.mock("#/features/site-feedback/components/site-feedback-form", () => ({
  SiteFeedbackForm: ({
    pageContext,
    onSubmitted,
  }: {
    pageContext: FeedbackPageContext;
    onSubmitted?: () => void;
  }) => (
    <div data-testid="site-form">
      <span data-testid="site-page-url">{pageContext.pageUrl}</span>
      <span data-testid="site-screenshot">
        {pageContext.screenshot?.dataUrl ?? "none"}
      </span>
      <button type="button" onClick={onSubmitted}>
        stub submit site
      </button>
    </div>
  ),
}));

vi.mock("#/features/club-feedback/components/club-feedback-form", () => ({
  ClubFeedbackForm: (props: { onSubmitted?: () => void }) => (
    <div data-testid="club-form">
      {/* The stub renders whatever props it was given, so a leak of page
          context into the club form would show up here. */}
      <span data-testid="club-props">{Object.keys(props).join(",")}</span>
      <button type="button" onClick={props.onSubmitted}>
        stub submit club
      </button>
    </div>
  ),
}));

const SHOT: CapturedScreenshot = {
  dataUrl: "data:image/webp;base64,SHOT",
  contentType: "image/webp",
  bytes: 3,
};

function Trigger() {
  const { open } = useFeedbackLauncher();
  return (
    <button type="button" onClick={open}>
      open feedback
    </button>
  );
}

function setup(
  surfaces: { site: boolean; club: boolean },
  capture: () => Promise<CapturedScreenshot | null> = vi.fn(async () => SHOT),
) {
  render(
    <FeedbackLauncherProvider
      canSend={surfaces.site || surfaces.club}
      captureScreenshot={surfaces.site}
      capture={capture}
    >
      <Trigger />
      <FeedbackDialog surfaces={surfaces} />
    </FeedbackLauncherProvider>,
  );
  return { capture };
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "open feedback" }));
  await screen.findByRole("dialog");
}

describe("FeedbackDialog", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    window.history.pushState({}, "", "/gear");
  });

  it("skips the chooser when only site is available", async () => {
    setup({ site: true, club: false });
    await openDialog();
    expect(screen.getByTestId("site-form")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Back/ }),
    ).not.toBeInTheDocument();
  });

  it("skips the chooser when only club is available", async () => {
    setup({ site: false, club: true });
    await openDialog();
    expect(screen.getByTestId("club-form")).toBeInTheDocument();
  });

  it("shows Club and Site choices when both are", async () => {
    setup({ site: true, club: true });
    await openDialog();
    expect(
      screen.getByRole("button", { name: /Club feedback/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Site feedback/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("site-form")).not.toBeInTheDocument();
  });

  it("Back returns to the chooser", async () => {
    setup({ site: true, club: true });
    await openDialog();
    await userEvent.click(
      screen.getByRole("button", { name: /Site feedback/ }),
    );
    expect(screen.getByTestId("site-form")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(
      screen.getByRole("button", { name: /Club feedback/ }),
    ).toBeInTheDocument();
  });

  it("Club → Back → Site still has the screenshot", async () => {
    setup({ site: true, club: true });
    await openDialog();
    await userEvent.click(
      screen.getByRole("button", { name: /Club feedback/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Site feedback/ }),
    );
    expect(screen.getByTestId("site-screenshot")).toHaveTextContent(
      SHOT.dataUrl,
    );
  });

  it("submitting club feedback sends no page context and closes", async () => {
    setup({ site: true, club: true });
    await openDialog();
    await userEvent.click(
      screen.getByRole("button", { name: /Club feedback/ }),
    );
    expect(screen.getByTestId("club-props")).toHaveTextContent(/^onSubmitted$/);
    await userEvent.click(
      screen.getByRole("button", { name: "stub submit club" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Thanks — see it in My feedback");
  });

  it("closing discards the context, so the next open recaptures", async () => {
    const { capture } = setup({ site: true, club: false });
    await openDialog();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    window.history.pushState({}, "", "/sponsors");
    await openDialog();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("site-page-url")).toHaveTextContent(
      /\/sponsors$/,
    );
  });

  it("opens without a screenshot when capture rejects", async () => {
    setup({ site: true, club: false }, () => Promise.reject(new Error("boom")));
    await openDialog();
    expect(screen.getByTestId("site-screenshot")).toHaveTextContent("none");
  });

  it("site form gets the pageUrl captured at open, not the current location", async () => {
    setup({ site: true, club: false });
    await openDialog();
    window.history.pushState({}, "", "/somewhere-else");
    expect(screen.getByTestId("site-page-url")).toHaveTextContent(/\/gear$/);
  });

  it("site submit toasts and closes", async () => {
    setup({ site: true, club: false });
    await openDialog();
    await userEvent.click(
      screen.getByRole("button", { name: "stub submit site" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Thanks — see it in My feedback");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
