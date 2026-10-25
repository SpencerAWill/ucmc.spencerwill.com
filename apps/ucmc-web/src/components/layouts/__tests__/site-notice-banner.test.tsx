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

function setReducedMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
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
      return this.dataset.slot === "notice-text" ? widths.text : 0;
    },
  );
  setReducedMotion(false);
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
    expect(copies()[0]).toHaveClass("truncate");
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

  it("pauses on hover and on focus within, in CSS", () => {
    // jsdom applies no stylesheet, so this pins the hook rather than the
    // effect: the variants are keyed to the bar's own group.
    render(<SiteNoticeBar text={TEXT} tone="info" />);
    resize({ viewport: 300, text: 552 });

    expect(bar()).toHaveClass("group/notice");
    expect(strip()).toHaveClass(
      "group-hover/notice:[animation-play-state:paused]",
      "group-focus-within/notice:[animation-play-state:paused]",
    );
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
    expect(copies()[0]).toHaveClass("whitespace-normal");
    expect(copies()[0]).not.toHaveClass("truncate");
    expect(screen.queryByRole("button")).toBeNull();
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
