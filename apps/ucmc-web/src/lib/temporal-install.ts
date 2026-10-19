/**
 * Installs temporal-polyfill's `Temporal` onto the global — always,
 * replacing any native `Temporal` the runtime already provides.
 *
 * `temporal-polyfill/global` (what every entry point used to import) does
 * NOT do this: its `install()` is `NativeTemporal || installImplementation()`,
 * so it steps aside for a native implementation. The package root
 * (`import { Temporal } from "temporal-polyfill"`) does the same:
 * `NativeTemporal || Temporal$1`. That deference is the bug. In July 2026
 * the deployed workerd briefly shipped a native `Temporal` whose clock read
 * epoch 0 inside requests while `Date.now()` was correct
 * (cloudflare/workerd#6907). Season boundaries, waiver terms, session
 * expiry and cron scheduling would all have been wrong in prod, and the
 * tests — running under the same workerd — would have stayed green.
 *
 * Forcing the polyfill also gives the server and every browser the same
 * implementation, so a value rendered during SSR formats identically when
 * it hydrates, whatever native Temporal the viewer's browser ships.
 * Switching to native is a deliberate change here, once it has proven
 * stable on Workers.
 *
 * Import this module for its side effect, first, at every entry point:
 * `server-entry.ts`, `router.tsx`, `.storybook/preview.ts`, each vitest
 * setup file and the e2e DB fixture. ESLint bans every deferring entry
 * point in `src/` (the package root, `/global`, their `/full` twins and the
 * shim's `install`) so one can't creep back in. Code reads the global
 * `Temporal`, typed by `src/temporal-global.d.ts`.
 */
import { installImplementation } from "temporal-polyfill/shim";

installImplementation();
