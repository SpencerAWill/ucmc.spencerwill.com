import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't ship `ResizeObserver`; some Radix primitives (e.g. the
// `@radix-ui/react-checkbox` powering shadcn's Checkbox) reference it
// during render and crash without a polyfill. A no-op stub is enough —
// these tests don't inspect resize behavior.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Testing Library appends rendered output to document.body for each test;
// without explicit cleanup, queries from one test leak into the next.
afterEach(() => {
  cleanup();
});
