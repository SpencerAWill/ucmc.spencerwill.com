// Makes the TC39 `Temporal` global namespace types available program-wide.
//
// The runtime polyfill is installed via side-effect imports at each entry
// point (`server-entry.ts`, `router.tsx`, and both vitest setup files).
// This file pulls in the ambient `declare global { namespace Temporal }`
// from `temporal-spec/global` (re-exported by `temporal-polyfill/global`)
// so every `*.ts`/`*.tsx` in the program sees `Temporal.Instant`,
// `Temporal.ZonedDateTime`, etc. without an explicit import.
import "temporal-polyfill/global";
