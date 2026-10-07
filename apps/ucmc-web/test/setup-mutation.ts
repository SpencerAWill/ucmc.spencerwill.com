// Node has no native Temporal; install the polyfill before any test
// module touches it. Mirrors `test/apply-migrations.ts` (workers) and
// `test/setup-dom.ts` (jsdom) — this file is the equivalent for the
// Stryker-only `mutation` project, which runs in plain Node.
import "temporal-polyfill/global";
