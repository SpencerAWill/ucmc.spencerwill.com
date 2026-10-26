/**
 * The site notice's tones are presets rather than a colour picker so that
 * every one can be held to WCAG AA: 4.5:1 between `--notice-<tone>` and
 * `--notice-<tone>-foreground`, in light and in dark. This reads the real
 * stylesheet, so retuning a token is what this checks — not a copy of it.
 *
 * The conversion is OKLCH → OKLab → linear sRGB (Björn Ottosson's
 * matrices), clamped to the sRGB gamut, then WCAG relative luminance from
 * the linear channels directly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NOTICE_TONES } from "#/server/settings/site-notice";

// Read from disk rather than `import css from "#/styles.css?raw"`: both
// vitest pools stub CSS modules, so `?raw` comes back as an empty string
// and every assertion below would fail on a missing token. Lives in the
// dom pool (`.tsx`) because the workers pool has no filesystem.
const css = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "styles.css"),
  "utf8",
);

const AA = 4.5;

/** The custom properties declared directly in the first `selector {}` block. */
function parseBlock(source: string, selector: string): Map<string, string> {
  const start = source.indexOf(`\n${selector} {`);
  if (start === -1) {
    throw new Error(`No ${selector} block in styles.css`);
  }
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  return new Map(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]),
  );
}

function oklchToLinearRgb(value: string): [number, number, number] {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!match) {
    throw new Error(`Not an oklch() colour: ${value}`);
  }
  const l = Number(match[1]);
  const c = Number(match[2]);
  const h = (Number(match[3]) * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

function relativeLuminance(value: string): number {
  const [r, g, b] = oklchToLinearRgb(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const THEMES = { light: ":root", dark: ".dark" } as const;

describe("contrast maths", () => {
  it("measures black on white as 21:1", () => {
    expect(contrast("oklch(0 0 0)", "oklch(1 0 0)")).toBeCloseTo(21, 1);
  });

  it("agrees that the header's own pair clears AA", () => {
    // A known-good pair from the same file proves the parser and the
    // conversion before any notice token is judged by them.
    const root = parseBlock(css, ":root");
    const ratio = contrast(
      root.get("--header") ?? "",
      root.get("--header-foreground") ?? "",
    );
    expect(ratio).toBeGreaterThan(AA);
  });
});

describe("notice tones clear WCAG AA", () => {
  const cases = NOTICE_TONES.flatMap((tone) =>
    (Object.keys(THEMES) as (keyof typeof THEMES)[]).map(
      (theme) => [tone, theme] as const,
    ),
  );

  it.each(cases)("%s in %s", (tone, theme) => {
    const block = parseBlock(css, THEMES[theme]);
    const bg = block.get(`--notice-${tone}`);
    const fg = block.get(`--notice-${tone}-foreground`);
    expect(bg, `--notice-${tone} missing from ${theme}`).toBeDefined();
    expect(
      fg,
      `--notice-${tone}-foreground missing from ${theme}`,
    ).toBeDefined();

    const ratio = contrast(bg ?? "", fg ?? "");
    expect(
      ratio,
      `${tone} ${theme}: ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA);
  });
});
