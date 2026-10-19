// Makes the TC39 `Temporal` global namespace types available program-wide.
//
// The runtime polyfill is installed by `#/lib/temporal-install`, imported
// for its side effect at each entry point (`server-entry.ts`, `router.tsx`,
// the vitest setup files and the e2e DB fixture).
// This file pulls in the ambient `declare global { namespace Temporal }`
// from `temporal-spec/global` so every `*.ts`/`*.tsx` in the program sees
// `Temporal.Instant`, `Temporal.ZonedDateTime`, etc. without an explicit
// import. As of temporal-polyfill v1 the runtime entry points ship no
// global types; the ambient declarations live behind
// `temporal-polyfill/types/global`, which installs nothing at runtime.
import "temporal-polyfill/types/global";
