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
  };
}

// jsdom also doesn't implement the Pointer Events methods Radix Select
// (and a few sibling primitives) calls during user interaction. Without
// these stubs, a `userEvent.click()` on a SelectTrigger throws
// "target.hasPointerCapture is not a function" and the test crashes.
// All three are no-ops; the tests don't inspect pointer-capture or
// scroll behavior.
// TypeScript believes these DOM methods are always present because the
// standard Element interface declares them — but jsdom doesn't implement
// them, so at runtime they're `undefined`. The `as unknown as undefined`
// casts let the existence check express the runtime truth without
// fighting the lib.dom typings; each method gets a no-op stub if absent.
if (typeof Element !== "undefined") {
  if ((Element.prototype.hasPointerCapture as unknown) === undefined) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if ((Element.prototype.releasePointerCapture as unknown) === undefined) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if ((Element.prototype.scrollIntoView as unknown) === undefined) {
    Element.prototype.scrollIntoView = () => {};
  }
}

// Testing Library appends rendered output to document.body for each test;
// without explicit cleanup, queries from one test leak into the next.
afterEach(() => {
  cleanup();
});
