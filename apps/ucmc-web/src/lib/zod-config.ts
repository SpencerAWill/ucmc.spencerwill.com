/**
 * Side-effect module that disables zod's JIT object validator. Must be
 * the FIRST import of any client/server entry that transitively reaches
 * a `.parse()` call — most importantly, `env.ts` (via `@t3-oss/env-core`)
 * runs schema validation at module-eval time, so any earlier import would
 * cache `allowsEval` before this config takes effect.
 *
 * Why disable JIT: zod v4's `$ZodObjectJIT` compiles validators with
 * `new Function()`, which trips our `script-src` CSP (no `'unsafe-eval'`)
 * on every parse. zod 4.4.3 also short-circuits the `allowsEval` probe
 * under `jitless`, so the feature-detect itself stays silent — letting
 * the CSP enforce mode stay clean without surprises.
 */
import { z } from "zod";

z.config({ jitless: true });
