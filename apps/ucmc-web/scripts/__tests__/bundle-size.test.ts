import { describe, expect, it } from "vitest";

import { CLIENT_BUDGET } from "../bundle-budget";
import {
  ambiguousExemptions,
  BundleSizeError,
  checkClientBudget,
  measureChunks,
  parseWranglerTotals,
  staleExemptions,
} from "../bundle-size";
import type { ClientBudget, Manifest, MeasuredChunk } from "../bundle-size";

/** Shaped like Vite's client manifest: an entry, a static chain, a lazy route. */
const MANIFEST: Manifest = {
  "src/client.tsx": {
    file: "assets/index-a.js",
    name: "index",
    isEntry: true,
    imports: ["_react-b.js"],
  },
  "_react-b.js": { file: "assets/react-b.js", imports: ["_scheduler-c.js"] },
  "_scheduler-c.js": { file: "assets/scheduler-c.js", name: "scheduler" },
  "src/routes/feedback.tsx": {
    file: "assets/feedback-d.js",
    name: "feedback",
    imports: ["_react-b.js"],
  },
  "src/fonts/manrope.woff2": { file: "assets/manrope-e.woff2" },
};

const BUDGET: ClientBudget = {
  initialGzipKb: 100,
  entryGzipKb: 80,
  chunkGzipKb: 10,
  lazyExemptions: ["markdown-editor"],
};

function chunk(overrides: Partial<MeasuredChunk>): MeasuredChunk {
  return {
    name: "chunk",
    file: "assets/chunk.js",
    gzipKb: 1,
    isEntry: false,
    isInitial: false,
    ...overrides,
  };
}

describe("measureChunks", () => {
  const chunks = measureChunks(MANIFEST, () => 1);
  const byFile = (file: string) => chunks.find((c) => c.file === file);

  it("follows static imports transitively from the entry", () => {
    expect(byFile("assets/index-a.js")).toMatchObject({
      isEntry: true,
      isInitial: true,
    });
    expect(byFile("assets/react-b.js")?.isInitial).toBe(true);
    expect(byFile("assets/scheduler-c.js")?.isInitial).toBe(true);
  });

  it("doesn't count a chunk only another lazy chunk imports", () => {
    expect(byFile("assets/feedback-d.js")?.isInitial).toBe(false);
  });

  it("measures JS only, naming an unnamed chunk by its file", () => {
    expect(chunks.map((c) => c.file)).not.toContain("assets/manrope-e.woff2");
    expect(byFile("assets/react-b.js")?.name).toBe("assets/react-b.js");
  });

  it("sizes each chunk by its file", () => {
    const sized = measureChunks(MANIFEST, (file) => file.length);
    expect(sized.find((c) => c.name === "index")?.gzipKb).toBe(
      "assets/index-a.js".length,
    );
  });

  // An empty initial set would sum to zero and pass every budget.
  it("fails when the manifest has no entry", () => {
    expect(() =>
      measureChunks({ "a.js": { file: "assets/a.js" } }, () => 1),
    ).toThrow(BundleSizeError);
  });
});

describe("checkClientBudget", () => {
  it("passes a build at exactly its budgets", () => {
    const chunks = [
      chunk({ name: "index", gzipKb: 80, isEntry: true, isInitial: true }),
      chunk({ name: "react", gzipKb: 10, isInitial: true }),
      chunk({ name: "route", gzipKb: 10 }),
    ];
    expect(checkClientBudget(chunks, BUDGET)).toEqual([]);
  });

  it("sums every initial chunk, lazy ones excluded", () => {
    const chunks = [
      chunk({ name: "index", gzipKb: 80, isEntry: true, isInitial: true }),
      chunk({ name: "a", gzipKb: 10, isInitial: true }),
      chunk({ name: "b", gzipKb: 10, isInitial: true }),
      chunk({ name: "c", gzipKb: 0.5, isInitial: true }),
      chunk({ name: "lazy", gzipKb: 9 }),
    ];
    expect(checkClientBudget(chunks, BUDGET)).toEqual([
      expect.objectContaining({ chunk: "(total)", sizeKb: 100.5 }),
    ]);
  });

  it("holds the entry to its own cap, not the chunk cap", () => {
    const under = [chunk({ name: "index", gzipKb: 79, isEntry: true })];
    const over = [chunk({ name: "index", gzipKb: 81, isEntry: true })];
    expect(checkClientBudget(under, BUDGET)).toEqual([]);
    expect(checkClientBudget(over, BUDGET)).toEqual([
      {
        check: "entry chunk",
        chunk: "index",
        file: "assets/chunk.js",
        sizeKb: 81,
        budgetKb: 80,
      },
    ]);
  });

  it("names every chunk over the chunk cap, lazy or initial", () => {
    const chunks = [
      chunk({ name: "route", gzipKb: 11 }),
      chunk({ name: "shared", gzipKb: 12, isInitial: true }),
    ];
    expect(
      checkClientBudget(chunks, { ...BUDGET, initialGzipKb: 1000 }).map((v) => [
        v.chunk,
        v.budgetKb,
      ]),
    ).toEqual([
      ["route", 10],
      ["shared", 10],
    ]);
  });

  it("lets an exempt chunk past the cap while it stays lazy", () => {
    const chunks = [chunk({ name: "markdown-editor", gzipKb: 185 })];
    expect(checkClientBudget(chunks, BUDGET)).toEqual([]);
  });

  it("fails an exempt chunk that becomes part of the initial load", () => {
    const chunks = [
      chunk({ name: "markdown-editor", gzipKb: 1, isInitial: true }),
    ];
    expect(checkClientBudget(chunks, BUDGET)).toEqual([
      expect.objectContaining({
        check: "exempt chunk is no longer lazy",
        chunk: "markdown-editor",
      }),
    ]);
  });
});

describe("staleExemptions", () => {
  it("lists exemptions that match no chunk", () => {
    expect(
      staleExemptions([chunk({ name: "markdown-editor" })], {
        ...BUDGET,
        lazyExemptions: ["markdown-editor", "map"],
      }),
    ).toEqual(["map"]);
  });
});

describe("ambiguousExemptions", () => {
  // Rollup chunk names aren't unique; one shared name would exempt every
  // chunk that carries it.
  it("lists exemptions that name more than one chunk", () => {
    expect(
      ambiguousExemptions(
        [
          chunk({ name: "markdown-editor" }),
          chunk({ name: "dist", file: "assets/dist-a.js" }),
          chunk({ name: "dist", file: "assets/dist-b.js" }),
        ],
        { ...BUDGET, lazyExemptions: ["markdown-editor", "dist"] },
      ),
    ).toEqual(["dist"]);
  });
});

describe("CLIENT_BUDGET", () => {
  // The entry cap is the only one above the chunk cap; a budget edit that
  // swapped them would exempt every route chunk without saying so.
  it("keeps the chunk cap below the entry cap below the initial cap", () => {
    expect(CLIENT_BUDGET.chunkGzipKb).toBeLessThan(CLIENT_BUDGET.entryGzipKb);
    expect(CLIENT_BUDGET.entryGzipKb).toBeLessThan(CLIENT_BUDGET.initialGzipKb);
  });
});

describe("parseWranglerTotals", () => {
  it("reads the Total Upload line", () => {
    expect(
      parseWranglerTotals(
        "Your Worker has access to...\nTotal Upload: 9888.42 KiB / gzip: 2300.14 KiB\n",
      ),
    ).toEqual({ rawKib: 9888.42, gzipKib: 2300.14 });
  });

  it("converts MiB to KiB", () => {
    expect(
      parseWranglerTotals("Total Upload: 10.5 MiB / gzip: 2.25 MiB"),
    ).toEqual({ rawKib: 10752, gzipKib: 2304 });
  });

  // The caller fails on null, so a reworded line can't turn the check off.
  it("returns null when the line is missing", () => {
    expect(parseWranglerTotals("Total upload: 10 KiB")).toBeNull();
  });
});
