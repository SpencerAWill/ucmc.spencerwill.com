/**
 * The site notice bar: one line, and a ticker when the text doesn't fit.
 *
 * jsdom has no layout, so the widths the bar measures are stubbed and the
 * `ResizeObserver` is driven by hand. That is also what lets these tests
 * cover the case a mount-only check reads straight past: a phone rotating
 * across the threshold, where the ticker has to engage AND disengage.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  marqueeDurationSeconds,
  SiteNoticeBanner,
  SiteNoticeBar,
} from "#/components/layouts/site-notice-banner";
import { siteNoticeQueryKey } from "#/features/settings/api/query-keys";
import { authStub } from "#/test-support/auth-stub";

const useAuth = vi.hoisted(() => vi.fn());
vi.mock("#/features/auth/api/use-auth", () => ({ useAuth }));

// ── layout stubs ────────────────────────────────────────────────────────

const widths = { viewport: 300, text: 200 };
const observers: (() => void)[] = [];

class ControlledResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    observers.push(() => this.callback([], this));
  }
  unobserve() {}
  disconnect() {}
}

/** Resize to `next` and deliver the observer callbacks, as a browser would. */
function resize(next: Partial<typeof widths>) {
  Object.assign(widths, next);
  act(() => {
    for (const fire of observers) {
      fire();
    }
  });
}

const motionListeners = new Set<(event: MediaQueryListEvent) => void>();
const motion = { reduce: false };

/** Sets the preference; after mount, tells listeners as the browser would. */
function setReducedMotion(reduce: boolean) {
  motion.reduce = reduce;
  act(() => {
    for (const listener of motionListeners) {
      listener({ matches: reduce } as MediaQueryListEvent);
    }
  });
}

function stubMatchMedia() {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: motion.reduce && query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => {
          if (query === "(prefers-reduced-motion: reduce)") {
            motionListeners.add(listener);
          }
        },
        removeEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => {
          motionListeners.delete(listener);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

beforeEach(() => {
  observers.length = 0;
  Object.assign(widths, { viewport: 300, text: 200 });
  vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.slot === "notice-viewport" ? widths.viewport : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.slot !== "notice-text") {
        return 0;
      }
      // Wrapped text grows downwards, so it never measures wider than
      // the viewport — as in a real layout.
      return this.classList.contains("whitespace-normal")
        ? Math.min(widths.text, widths.viewport)
        : widths.text;
    },
  );
  motionListeners.clear();
  motion.reduce = false;
  stubMatchMedia();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TEXT = "ALL gear must be turned in before spring break trips";

const bar = () => screen.getByRole("complementary", { name: "Site notice" });
const copies = () => screen.getAllByText(TEXT);
const strip = () => {
  const el = bar().querySelector<HTMLElement>("[data-slot='notice-strip']");
  if (!el) {
    throw new Error("no strip");
  }
  return el;
};

// ── SiteNoticeBar ───────────────────────────────────────────────────────

describe("SiteNoticeBar", () => {
  it("is a labelled landmark in the tone's colours", () => {
    render(<SiteNoticeBar text={TEXT} tone="warning" />);

    expect(bar()).toHaveTextContent(TEXT);
    expect(bar()).toHaveClass(
      "bg-notice-warning",
      "text-notice-warning-foreground",
    );
  });

  it("shows one truncated line and no control when the text fits", () => {
    render(<SiteNoticeBar text={TEXT} tone="info" />);
    resize({ viewport: 300, text: 200 });

    expect(copies()).toHaveLength(1);
    expect(copies()[0]).toHaveClass("truncate", "text-center");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("scrolls a second, hidden copy when the text overflows", () => {
    render(<SiteNoticeBar text={TEXT} tone="info" />);
    resize({ viewport: 300, text: 552 });

    expect(copies()).toHaveLength(2);
    expect(copies()[1]?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(copies()[0]?.closest("[aria-hidden='true']")).toBeNull();
    // One loop is the text plus the gap after it (pr-12 = 48px).
    expect(strip().style.animationDuration).toBe(
      `${marqueeDurationSeconds(552 + 48)}s`,
    );
    expect(strip().style.animationPlayState).toBe("");
  });

  it("pauses and resumes from its button", async () => {
    const user = userEvent.setup();
    render(<SiteNoticeBar text={TEXT} tone="info" />);
    resize({ viewport: 300, text: 552 });

    const pause = screen.getByRole("button", { name: "Pause notice" });
    expect(pause).toHaveAttribute("aria-pressed", "false");
    await user.click(pause);

    const play = screen.getByRole("button", { name: "Play notice" });
    expect(play).toHaveAttribute("aria-pressed", "true");
    expect(strip().style.animationPlayState).toBe("paused");

    await user.click(play);
    expect(screen.getByRole("button", { name: "Pause notice" })).toBeVisible();
    // Never an inline "running": it would beat the hover/focus classes.
    expect(strip().style.animationPlayState).toBe("");
  });

  it("pauses on hover, in CSS", () => {
    // jsdom applies no stylesheet, so this pins the hook rather than the
    // effect: the variant is keyed to the bar's own group, and Tailwind's
    // hover variants only apply on devices that can hover.
    render(<SiteNoticeBar text={TEXT} tone="info" />);
    resize({ viewport: 300, text: 552 });

    expect(bar()).toHaveClass("group/notice");
    expect(strip()).toHaveClass(
      "group-hover/notice:[animation-play-state:paused]",
    );
  });

  it("plays again from its button while the button keeps focus", async () => {
    // The button is the only focusable thing in the bar, and a tap (or
    // Enter) leaves it focused. A focus-within pause therefore held the
    // ticker still after Play on a phone, until the user tapped elsewhere.
    const user = userEvent.setup();
    render(<SiteNoticeBar text={TEXT} tone="info" />);
    resize({ viewport: 300, text: 552 });

    await user.click(screen.getByRole("button", { name: "Pause notice" }));
    await user.click(screen.getByRole("button", { name: "Play notice" }));

    expect(screen.getByRole("button", { name: "Pause notice" })).toHaveFocus();
    expect(strip().style.animationPlayState).toBe("");
    expect(strip().className).not.toMatch(/focus/);
  });

  it("stops ticking when a resize makes the text fit again", () => {
    render(<SiteNoticeBar text={TEXT} tone="info" />);
    resize({ viewport: 300, text: 552 });
    expect(copies()).toHaveLength(2);

    resize({ viewport: 800 });
    expect(copies()).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("wraps instead of moving under reduced motion", () => {
    setReducedMotion(true);
    render(<SiteNoticeBar text={TEXT} tone="info" />);
    resize({ viewport: 300, text: 552 });

    expect(copies()).toHaveLength(1);
    expect(copies()[0]).toHaveClass("whitespace-normal", "text-center");
    expect(copies()[0]).not.toHaveClass("truncate");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("SiteNoticeBar, reduced motion switched off", () => {
  it("starts ticking without waiting for a resize", () => {
    // Wrapped text never measures as overflowing, so nothing about the
    // width changes when the preference flips — the bar has to re-ask.
    setReducedMotion(true);
    render(<SiteNoticeBar text={TEXT} tone="info" />);
    resize({ viewport: 300, text: 552 });
    expect(copies()).toHaveLength(1);

    setReducedMotion(false);
    expect(copies()).toHaveLength(2);
  });
});

describe("marqueeDurationSeconds", () => {
  it("moves at 60px a second", () => {
    expect(marqueeDurationSeconds(600)).toBe(10);
  });
});

// ── SiteNoticeBanner ────────────────────────────────────────────────────

describe("SiteNoticeBanner", () => {
  function renderBanner(client: QueryClient) {
    return render(
      <QueryClientProvider client={client}>
        <SiteNoticeBanner />
      </QueryClientProvider>,
    );
  }

  function clientWith(
    entries: [Parameters<typeof siteNoticeQueryKey>[0], unknown][],
  ) {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    for (const [viewer, data] of entries) {
      client.setQueryData(siteNoticeQueryKey(viewer), data);
    }
    return client;
  }

  it("renders nothing when the server answered no notice", () => {
    useAuth.mockReturnValue(authStub([], { isApproved: false }));
    renderBanner(clientWith([["anonymous", null]]));

    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("reads the entry for the signed-in viewer, not the anonymous one", () => {
    useAuth.mockReturnValue(
      authStub([], { principal: { status: "approved" } }),
    );
    renderBanner(
      clientWith([
        ["anonymous", null],
        ["approved", { text: TEXT, tone: "success" }],
      ]),
    );

    expect(bar()).toHaveTextContent(TEXT);
  });
});
