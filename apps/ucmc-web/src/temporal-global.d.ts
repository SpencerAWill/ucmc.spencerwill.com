// Makes the TC39 `Temporal` global namespace types available program-wide.
//
// The runtime polyfill is installed via side-effect imports at each entry
// point (`server-entry.ts`, `router.tsx`, and both vitest setup files).
// This file pulls in the ambient `declare global { namespace Temporal }`
// from `temporal-spec/global` so every `*.ts`/`*.tsx` in the program sees
// `Temporal.Instant`, `Temporal.ZonedDateTime`, etc. without an explicit
// import. As of temporal-polyfill v1 the `/global` subpath installs only
// the runtime polyfill (its `.d.ts` is empty); the ambient global types
// now live behind `temporal-polyfill/types/global`.
import "temporal-polyfill/types/global";
