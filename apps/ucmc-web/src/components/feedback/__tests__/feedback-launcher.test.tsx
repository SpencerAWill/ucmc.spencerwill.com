/**
 * The launcher records where the member was when they asked to send
 * feedback, so the report names that page even after the dialog opens
 * (and on a phone, after it covers the page). Capture is injected; a
 * failed capture must still open the dialog.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FeedbackLauncherProvider,
  useFeedbackLauncher,
  useFeedbackLauncherState,
} from "#/components/feedback/feedback-launcher";
import type { CapturedScreenshot } from "#/components/feedback/feedback-launcher";

const SHOT: CapturedScreenshot = {
  dataUrl: "data:image/webp;base64,AAAA",
  contentType: "image/webp",
  bytes: 3,
};

function both() {
  return { launcher: useFeedbackLauncher(), state: useFeedbackLauncherState() };
}

function renderLauncher(
  props: Partial<{
    canSend: boolean;
    captureScreenshot: boolean;
    capture: () => Promise<CapturedScreenshot | null>;
  }> = {},
) {
  const capture = props.capture ?? vi.fn(async () => SHOT);
  const view = renderHook(both, {
    wrapper: ({ children }) => (
      <FeedbackLauncherProvider
        canSend={props.canSend ?? true}
        captureScreenshot={props.captureScreenshot ?? true}
        capture={capture}
      >
        {children}
      </FeedbackLauncherProvider>
    ),
  });
  return { ...view, capture };
}

async function openAndWait(result: { current: ReturnType<typeof both> }) {
  act(() => {
    result.current.launcher.open();
  });
  await waitFor(() => expect(result.current.state.isOpen).toBe(true));
}

describe("feedback launcher", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("useFeedbackLauncher without a provider returns canSend false and a no-op open", () => {
    const { result } = renderHook(() => useFeedbackLauncher());
    expect(result.current.canSend).toBe(false);
    expect(() => result.current.open()).not.toThrow();
  });

  it("open records pageUrl and userAgent at open time", async () => {
    window.history.pushState({}, "", "/gear?tab=loans");
    const { result } = renderLauncher();
    await openAndWait(result);
    window.history.pushState({}, "", "/elsewhere");
    expect(result.current.state.context?.pageUrl).toBe(
      `${window.location.origin}/gear?tab=loans`,
    );
    expect(result.current.state.context?.userAgent).toBe(navigator.userAgent);
    expect(result.current.state.context?.screenshot).toEqual(SHOT);
  });

  it("open calls capture only when captureScreenshot is true", async () => {
    const off = renderLauncher({ captureScreenshot: false });
    await openAndWait(off.result);
    expect(off.capture).not.toHaveBeenCalled();
    expect(off.result.current.state.context?.screenshot).toBeNull();
    off.unmount();

    const on = renderLauncher({ captureScreenshot: true });
    await openAndWait(on.result);
    expect(on.capture).toHaveBeenCalledTimes(1);
  });

  it("opens with screenshot null when capture rejects", async () => {
    const { result } = renderLauncher({
      capture: () => Promise.reject(new Error("tainted canvas")),
    });
    await openAndWait(result);
    expect(result.current.state.context?.screenshot).toBeNull();
  });

  it("close clears the context", async () => {
    const { result } = renderLauncher();
    await openAndWait(result);
    act(() => {
      result.current.state.close();
    });
    expect(result.current.state.isOpen).toBe(false);
    expect(result.current.state.context).toBeNull();
  });

  it("ignores a second open while the first is still capturing", async () => {
    const capture = vi.fn(
      () =>
        new Promise<CapturedScreenshot | null>((resolve) => {
          setTimeout(() => resolve(SHOT), 20);
        }),
    );
    const { result } = renderLauncher({ capture });
    act(() => {
      result.current.launcher.open();
      result.current.launcher.open();
    });
    await waitFor(() => expect(result.current.state.isOpen).toBe(true));
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("userAgent is truncated to 500 characters", async () => {
    const spy = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue("x".repeat(600));
    const { result } = renderLauncher();
    await openAndWait(result);
    expect(result.current.state.context?.userAgent).toHaveLength(500);
    spy.mockRestore();
  });
});
