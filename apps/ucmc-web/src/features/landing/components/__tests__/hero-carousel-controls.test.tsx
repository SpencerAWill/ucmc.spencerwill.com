import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HeroArrows,
  HeroAutoplayDial,
} from "#/features/landing/components/hero-carousel-controls";

// The controls read `useCarousel()` rather than owning an embla
// instance, so stubbing that context is what lets these run without
// layout — embla measures the DOM and does nothing useful in jsdom.
const carouselMock = vi.hoisted(() => vi.fn());
vi.mock("#/components/ui/carousel", () => ({ useCarousel: carouselMock }));

const scrollPrev = vi.fn();
const scrollNext = vi.fn();
const listeners = new Map<string, () => void>();
let selectedSnap = 0;

function setCarousel() {
  carouselMock.mockReturnValue({
    scrollPrev,
    scrollNext,
    api: {
      selectedScrollSnap: () => selectedSnap,
      on: (event: string, fn: () => void) => listeners.set(event, fn),
      off: (event: string) => listeners.delete(event),
    },
  });
}

describe("<HeroArrows />", () => {
  beforeEach(() => {
    scrollPrev.mockReset();
    scrollNext.mockReset();
    setCarousel();
  });

  it("moves the carousel in both directions", async () => {
    const user = userEvent.setup();
    render(<HeroArrows />);

    await user.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(scrollPrev).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Next slide" }));
    expect(scrollNext).toHaveBeenCalledTimes(1);
  });

  it("reveals on focus, not hover alone", () => {
    // A hover-only control is one a keyboard user can tab to and never
    // see, so `focus-visible` has to be a reveal trigger too.
    render(<HeroArrows />);
    for (const name of ["Previous slide", "Next slide"]) {
      expect(screen.getByRole("button", { name }).className).toContain(
        "focus-visible:opacity-100",
      );
    }
  });
});

describe("<HeroAutoplayDial />", () => {
  beforeEach(() => {
    selectedSnap = 0;
    listeners.clear();
    setCarousel();
  });

  it("names the action it performs, not the current state", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <HeroAutoplayDial
        paused={false}
        onToggle={onToggle}
        delayMs={5000}
        timeUntilNext={() => 2500}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pause slideshow" }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <HeroAutoplayDial
        paused
        onToggle={onToggle}
        delayMs={5000}
        timeUntilNext={() => null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Resume slideshow" }),
    ).toBeInTheDocument();
  });

  it("drives the wedge from the time remaining", async () => {
    render(
      <HeroAutoplayDial
        paused={false}
        onToggle={vi.fn()}
        delayMs={5000}
        // 1s left of 5s → 80% elapsed.
        timeUntilNext={() => 1000}
      />,
    );
    const wedge = await waitForWedge();
    expect(Number(wedge.style.getPropertyValue("--hero-dial"))).toBeCloseTo(
      0.8,
      2,
    );
  });

  it("inverts the sweep on odd slides so it never snaps back", async () => {
    // Even slides fill 0→1 and odd slides drain 1→0, so each handoff
    // lands on a matching value. Same 80%-elapsed input as above.
    selectedSnap = 1;
    render(
      <HeroAutoplayDial
        paused={false}
        onToggle={vi.fn()}
        delayMs={5000}
        timeUntilNext={() => 1000}
      />,
    );
    const wedge = await waitForWedge();
    expect(Number(wedge.style.getPropertyValue("--hero-dial"))).toBeCloseTo(
      0.2,
      2,
    );
  });

  it("clamps a remaining time outside the delay", async () => {
    // The plugin can briefly report more than the delay around a manual
    // scroll; an unclamped fraction would render a negative wedge angle.
    render(
      <HeroAutoplayDial
        paused={false}
        onToggle={vi.fn()}
        delayMs={5000}
        timeUntilNext={() => 9000}
      />,
    );
    const wedge = await waitForWedge();
    expect(Number(wedge.style.getPropertyValue("--hero-dial"))).toBe(0);
  });

  it("renders no wedge while paused", () => {
    render(
      <HeroAutoplayDial
        paused
        onToggle={vi.fn()}
        delayMs={5000}
        timeUntilNext={() => null}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Resume slideshow" })
        .querySelector("[style*='conic-gradient']"),
    ).toBeNull();
  });
});

/** The wedge is written by a rAF loop, so wait a frame for the value. */
async function waitForWedge(): Promise<HTMLElement> {
  const node = document.querySelector<HTMLElement>("[style*='conic-gradient']");
  expect(node).not.toBeNull();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  return node!;
}
