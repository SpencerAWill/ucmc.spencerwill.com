/**
 * Build-time copy of the ZXing reader WASM into `public/zxing-wasm/`.
 *
 * The gear-desk scanner (`features/gear/components/barcode-scanner.tsx`)
 * falls back to the `barcode-detector` ponyfill on browsers with no
 * native `BarcodeDetector`. That ponyfill fetches a `.wasm` binary at
 * runtime, and its default source is a jsDelivr CDN URL — which our CSP's
 * `connect-src 'self'` blocks. So the scanner overrides `locateFile` to
 * point at `/zxing-wasm/`, and this script is what puts the binary there.
 *
 * Why a script and not a committed binary: the Emscripten glue JS inside
 * `zxing-wasm` and its `.wasm` are one artifact split across two files.
 * They share an import/export surface across versions, so a stale binary
 * still *instantiates* cleanly — and then throws `RuntimeError: table
 * index is out of bounds` on the first decode, because the indirect
 * function table doesn't line up. The scanner swallows per-frame decode
 * errors by design, so that failure is completely silent: camera preview
 * works, nothing ever scans.
 *
 * That is exactly what happened. `barcode-detector` was bumped from 3.1.3
 * to 3.2.0 in #144 and the hand-vendored binary was never refreshed, which
 * left every ponyfill-path browser unable to scan anything. Copying at
 * build time makes the installed package the single source of truth, so
 * the two halves cannot drift again. Output is gitignored, the same
 * arrangement `generate-sitemap.ts` uses.
 *
 * Resolution goes *through* `barcode-detector` rather than resolving
 * `zxing-wasm` directly: pnpm's strict layout doesn't hoist a transitive
 * dep into this package's `node_modules`, and going through the importer
 * guarantees we copy the exact nested copy the ponyfill will load.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ponyfillEntry = require.resolve("barcode-detector/ponyfill");
const wasmSource = createRequire(ponyfillEntry).resolve(
  "zxing-wasm/reader/zxing_reader.wasm",
);

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "zxing-wasm",
);
const outPath = join(outDir, "zxing_reader.wasm");

mkdirSync(outDir, { recursive: true });
copyFileSync(wasmSource, outPath);
console.log(`[sync-zxing-wasm] copied ${wasmSource} -> ${outPath}`);
