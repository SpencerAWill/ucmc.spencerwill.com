/**
 * The pure half of `check-bundle-size.ts`: classify the client build's
 * chunks from Vite's manifest, compare them with the budget in
 * `bundle-budget.ts`, and read Wrangler's upload totals. No filesystem and
 * no process here, so the tests can drive it with literals.
 */

/** One entry of `dist/client/.vite/manifest.json`, the fields used here. */
export interface ManifestChunk {
  file: string;
  name?: string;
  isEntry?: boolean;
  imports?: string[];
}

export type Manifest = Record<string, ManifestChunk>;

export interface ClientBudget {
  initialGzipKb: number;
  entryGzipKb: number;
  chunkGzipKb: number;
  lazyExemptions: readonly string[];
}

export interface MeasuredChunk {
  /** Rollup's chunk name, falling back to the file when it has none. */
  name: string;
  file: string;
  gzipKb: number;
  isEntry: boolean;
  /** The entry, or reachable from it through static imports. */
  isInitial: boolean;
}

export interface Violation {
  check: string;
  chunk: string;
  /** The emitted file, since Rollup chunk names aren't unique. */
  file: string;
  sizeKb: number;
  budgetKb: number;
}

export class BundleSizeError extends Error {}

/**
 * Every JS chunk in the manifest, sized by `gzipKbOf(file)`, with whether a
 * first page load downloads it. Fails when the manifest has no entry, since
 * an empty initial set would pass every check while measuring nothing.
 */
export function measureChunks(
  manifest: Manifest,
  gzipKbOf: (file: string) => number,
): MeasuredChunk[] {
  const entryKeys = Object.entries(manifest)
    .filter(([, chunk]) => chunk.isEntry === true)
    .map(([key]) => key);
  if (entryKeys.length === 0) {
    throw new BundleSizeError("The client manifest has no entry chunk.");
  }

  const initial = new Set<string>();
  const pending = [...entryKeys];
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || initial.has(key)) {
      continue;
    }
    initial.add(key);
    // A key the manifest doesn't hold contributes nothing to walk.
    if (key in manifest) {
      pending.push(...(manifest[key].imports ?? []));
    }
  }

  return Object.entries(manifest)
    .filter(([, chunk]) => chunk.file.endsWith(".js"))
    .map(([key, chunk]) => ({
      name: chunk.name ?? chunk.file,
      file: chunk.file,
      gzipKb: gzipKbOf(chunk.file),
      isEntry: chunk.isEntry === true,
      isInitial: initial.has(key),
    }));
}

export function checkClientBudget(
  chunks: readonly MeasuredChunk[],
  budget: ClientBudget,
): Violation[] {
  const exempt = new Set(budget.lazyExemptions);
  const initialGzipKb = chunks
    .filter((chunk) => chunk.isInitial)
    .reduce((sum, chunk) => sum + chunk.gzipKb, 0);

  const violations: Violation[] = [];
  if (initialGzipKb > budget.initialGzipKb) {
    violations.push({
      check: "initial JS (entry + static imports)",
      chunk: "(total)",
      file: "",
      sizeKb: initialGzipKb,
      budgetKb: budget.initialGzipKb,
    });
  }
  for (const chunk of chunks) {
    if (chunk.isEntry) {
      if (chunk.gzipKb > budget.entryGzipKb) {
        violations.push({
          check: "entry chunk",
          chunk: chunk.name,
          file: chunk.file,
          sizeKb: chunk.gzipKb,
          budgetKb: budget.entryGzipKb,
        });
      }
    } else if (exempt.has(chunk.name)) {
      if (chunk.isInitial) {
        violations.push({
          check: "exempt chunk is no longer lazy",
          chunk: chunk.name,
          file: chunk.file,
          sizeKb: chunk.gzipKb,
          budgetKb: 0,
        });
      }
    } else if (chunk.gzipKb > budget.chunkGzipKb) {
      violations.push({
        check: "chunk",
        chunk: chunk.name,
        file: chunk.file,
        sizeKb: chunk.gzipKb,
        budgetKb: budget.chunkGzipKb,
      });
    }
  }
  return violations;
}

/** Exemptions that match no chunk: renamed or gone, so they exempt nothing. */
export function staleExemptions(
  chunks: readonly MeasuredChunk[],
  budget: ClientBudget,
): string[] {
  const names = new Set(chunks.map((chunk) => chunk.name));
  return budget.lazyExemptions.filter((name) => !names.has(name));
}

/**
 * Exemptions that match more than one chunk. Rollup chunk names aren't
 * unique (a build has a dozen `dist` chunks), so a name shared by several
 * chunks would exempt all of them, including ones nobody meant to.
 */
export function ambiguousExemptions(
  chunks: readonly MeasuredChunk[],
  budget: ClientBudget,
): string[] {
  return budget.lazyExemptions.filter(
    (name) => chunks.filter((chunk) => chunk.name === name).length > 1,
  );
}

export interface WorkerTotals {
  rawKib: number;
  gzipKib: number;
}

/**
 * Reads `Total Upload: <n> KiB / gzip: <n> KiB` from `wrangler deploy
 * --dry-run`. Returns null when the line isn't there, which the caller must
 * treat as a failure: a Wrangler release that reworded it would otherwise
 * turn the check off silently.
 */
export function parseWranglerTotals(output: string): WorkerTotals | null {
  const match = output.match(
    /Total Upload: ([\d.]+) (KiB|MiB) \/ gzip: ([\d.]+) (KiB|MiB)/,
  );
  if (!match) {
    return null;
  }
  const toKib = (value: string | undefined, unit: string | undefined) =>
    Number(value) * (unit === "MiB" ? 1024 : 1);
  return {
    rawKib: toKib(match[1], match[2]),
    gzipKib: toKib(match[3], match[4]),
  };
}
