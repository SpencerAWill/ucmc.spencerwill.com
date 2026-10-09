/**
 * Builds a contour-map banner from a member's public id.
 *
 * Every profile needs a header image and the club has no photo of
 * most members, so the banner is drawn rather than stored: same id,
 * same ridgeline, forever, with nothing to upload, moderate or pay
 * R2 for. A member who later wants a real picture there is a
 * separate feature (#257), and this is the floor it sits on.
 *
 * **Pure, and deterministic across server and client.** The paths are
 * rendered into the SSR HTML and must hash-for-hash match what React
 * produces on hydration, which rules out `Math.random`, the clock,
 * and anything that reads the DOM. It also makes the whole thing
 * mutation-testable, which is the only way an "it looks fine" module
 * gets any real coverage.
 */

/**
 * FNV-1a. Chosen because it is eight lines and stable — the output
 * feeds a member-visible image, so a hash that varied by platform or
 * by runtime version would redraw everyone's banner on deploy.
 */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32: one multiply-shift round, good enough for scenery. */
function makeRandom(state: number): () => number {
  let s = state;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TopoLine {
  /** SVG path data for one contour. */
  d: string;
  /**
   * Index contours — every fifth line on a real topo map, drawn
   * heavier. Without them the banner reads as wallpaper stripes
   * rather than terrain.
   */
  major: boolean;
}

export const TOPO_VIEWBOX = { width: 800, height: 200 } as const;

/** How many contours to draw. Enough to read as terrain, few enough to stay quiet behind an avatar. */
const LINE_COUNT = 16;
/** Sample points per line. 40 is smooth at banner width and keeps the markup small. */
const SAMPLES = 40;
const MAJOR_EVERY = 5;

/**
 * Three sine harmonics summed into one ridgeline, then sliced at
 * evenly spaced elevations.
 *
 * Real contours bunch where the ground is steep, and summing
 * harmonics at different frequencies reproduces that for free: the
 * lines crowd on the flanks of each hill and spread across its top.
 * A single sine gives evenly spaced waves, which reads as fabric.
 */
export function topoLines(seed: string): TopoLine[] {
  const random = makeRandom(hashSeed(seed));
  const { width, height } = TOPO_VIEWBOX;

  const harmonics = [0, 1, 2].map(() => ({
    amplitude: 10 + random() * 26,
    frequency: 0.6 + random() * 2.4,
    phase: random() * Math.PI * 2,
  }));

  const elevationAt = (t: number) =>
    harmonics.reduce(
      (sum, h) =>
        sum + h.amplitude * Math.sin(t * h.frequency * Math.PI * 2 + h.phase),
      0,
    );

  // Spread the lines over a little more than the banner so the top
  // and bottom edges are crossed rather than skirted — a contour that
  // stops short of the edge looks like a mistake.
  const spacing = (height * 1.6) / LINE_COUNT;
  const originY = -height * 0.3;

  return Array.from({ length: LINE_COUNT }, (_unused, line) => {
    const baseY = originY + line * spacing;
    const points = Array.from({ length: SAMPLES + 1 }, (_sample, i) => {
      const t = i / SAMPLES;
      const x = t * width;
      // Later lines sit lower AND ride the terrain slightly harder,
      // which gives the band some depth instead of looking extruded.
      const y = baseY + elevationAt(t) * (0.6 + line / LINE_COUNT);
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    });

    return {
      d: `M${points.join(" L")}`,
      major: line % MAJOR_EVERY === 0,
    };
  });
}
