import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SeasonRings } from "../season-rings";

const circles = (container: HTMLElement) => [
  ...container.querySelectorAll("circle"),
];
/** Closed rings are the circles with no dash pattern on them. */
const rings = (container: HTMLElement) =>
  circles(container).filter((c) => !c.getAttribute("stroke-dasharray"));
const arc = (container: HTMLElement) =>
  circles(container).find((c) => c.getAttribute("stroke-dasharray"));

describe("SeasonRings", () => {
  it("gives a first-season member an arc but no closed ring", () => {
    // The rule the whole component exists for: a ring is a season
    // SERVED, so it appears after the first one is finished, not on
    // the day someone joins.
    const { container } = render(
      <SeasonRings
        avatarKey={null}
        name="Jordan Reyes"
        completedSeasons={0}
        seasonProgress={0.25}
      />,
    );
    expect(rings(container)).toHaveLength(0);
    expect(arc(container)).toBeDefined();
  });

  it("gives someone starting their second season exactly one ring", () => {
    const { container } = render(
      <SeasonRings
        avatarKey={null}
        name="Jordan Reyes"
        completedSeasons={1}
        seasonProgress={0.05}
      />,
    );
    expect(rings(container)).toHaveLength(1);
  });

  it("draws no unfilled track behind the arc", () => {
    // A full grey circle behind the arc reads as a closed ring the
    // member has not earned — the exact thing the ring count is
    // supposed to tell them.
    const { container } = render(
      <SeasonRings
        avatarKey={null}
        name="Jordan Reyes"
        completedSeasons={0}
        seasonProgress={0.1}
      />,
    );
    expect(circles(container)).toHaveLength(1);
  });

  it("grows rings outward, with the arc outside all of them", () => {
    // First season against the avatar, each one after it further
    // out, and the in-progress arc beyond the lot — so tenure is
    // legible at a glance without counting.
    const { container } = render(
      <SeasonRings
        avatarKey={null}
        name="Jordan Reyes"
        completedSeasons={3}
        seasonProgress={0.5}
      />,
    );
    const radii = rings(container).map((c) => Number(c.getAttribute("r")));
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(Number(arc(container)?.getAttribute("r"))).toBeGreaterThan(
      Math.max(...radii),
    );
  });

  it("draws no arc at all between seasons", () => {
    const { container } = render(
      <SeasonRings
        avatarKey={null}
        name="Jordan Reyes"
        completedSeasons={2}
        seasonProgress={null}
      />,
    );
    expect(arc(container)).toBeUndefined();
    expect(rings(container)).toHaveLength(2);
  });

  it("offsets the arc dash in proportion to the season elapsed", () => {
    const { container } = render(
      <SeasonRings
        avatarKey={null}
        name="Jordan Reyes"
        completedSeasons={2}
        seasonProgress={0.25}
      />,
    );
    const stroke = arc(container);
    const total = Number(stroke?.getAttribute("stroke-dasharray"));
    const offset = Number(stroke?.getAttribute("stroke-dashoffset"));
    // A quarter done means three quarters still hidden. Getting this
    // backwards draws a ring that empties as the year goes on, which
    // looks plausible enough to ship.
    expect(offset / total).toBeCloseTo(0.75, 5);
  });

  it("starts the arc at twelve o'clock", () => {
    // SVG circles start at three o'clock, so without the rotation a
    // just-started season appears to begin on the right-hand side.
    const { container } = render(
      <SeasonRings
        avatarKey={null}
        name="Jordan Reyes"
        completedSeasons={0}
        seasonProgress={0.1}
      />,
    );
    expect(arc(container)).toHaveAttribute("transform", "rotate(-90 50 50)");
  });

  it("stops drawing rings before they become hatching", () => {
    const { container } = render(
      <SeasonRings
        avatarKey={null}
        name="An honorary member"
        completedSeasons={40}
        seasonProgress={null}
      />,
    );
    // Capped at five, matching the tenure ladder's "five seasons or
    // more" top rung.
    expect(rings(container)).toHaveLength(5);
  });

  it("announces the season count to a screen reader", () => {
    // The rings are the only place the number appears in the header,
    // so it cannot be left to the visual alone.
    render(
      <SeasonRings
        avatarKey={null}
        name="Jordan Reyes"
        completedSeasons={1}
        seasonProgress={null}
      />,
    );
    expect(
      screen.getByRole("img", { name: /1 season completed/ }),
    ).toBeInTheDocument();
  });
});
