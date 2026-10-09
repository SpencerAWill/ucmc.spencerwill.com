import { describe, expect, it } from "vitest";

import { TOPO_VIEWBOX, topoLines } from "../topo-banner";

describe("topoLines", () => {
  it("draws the same banner for the same member every time", () => {
    // The paths are rendered into the SSR HTML and must match what
    // the client produces on hydration. Anything non-deterministic
    // here is a hydration mismatch, which React papers over by
    // rerendering — so the symptom is a banner that flickers into a
    // different shape, not an error.
    expect(topoLines("k3x9-reyes")).toEqual(topoLines("k3x9-reyes"));
  });

  it("draws a different banner for a different member", () => {
    expect(topoLines("k3x9-reyes")).not.toEqual(topoLines("m7p2-kim"));
  });

  it("differs even for ids one character apart", () => {
    // Public ids are generated in a batch and often share a prefix.
    // A hash that only mixed the first few characters would give a
    // whole cohort the same ridgeline.
    expect(topoLines("aaaaaaaaaaa1")).not.toEqual(topoLines("aaaaaaaaaaa2"));
  });

  it("marks every fifth contour as an index line", () => {
    const lines = topoLines("k3x9-reyes");
    expect(lines.map((l) => l.major)).toEqual([
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("spans the full banner width", () => {
    // A contour that stops short of an edge reads as a broken image
    // rather than as terrain running off the page.
    for (const line of topoLines("k3x9-reyes")) {
      const xs = line.d
        .slice(1)
        .split(" L")
        .map((point) => Number(point.split(" ")[0]));
      expect(xs[0]).toBe(0);
      expect(xs.at(-1)).toBe(TOPO_VIEWBOX.width);
    }
  });

  it("emits only finite coordinates", () => {
    // `NaN` in path data silently drops the whole path, leaving a
    // blank banner with no error anywhere.
    const numbers = topoLines("k3x9-reyes")
      .flatMap((l) => l.d.slice(1).split(" L"))
      .flatMap((point) => point.split(" ").map(Number));
    expect(numbers.every(Number.isFinite)).toBe(true);
  });

  it("survives an empty seed rather than throwing", () => {
    // Nothing should render a profile without a public id, but a
    // banner is decoration and must not be what takes the page down.
    expect(topoLines("")).toHaveLength(16);
  });
});
