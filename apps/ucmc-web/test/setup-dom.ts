// jsdom has no native Temporal; install the polyfill before any test
// module touches a Temporal value (mirrors the client entry).
import "temporal-polyfill/global";
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

// jsdom doesn't implement `matchMedia`, which the sidebar's `useIsMobile`
// hook (and anything else keying off a media query) calls in an effect.
// Reports "not matching" and accepts listeners so components settle on
// their desktop branch; tests that need a specific viewport should stub
// `window.matchMedia` themselves.
// The `as unknown` cast is the same idiom as the Element stubs above:
// lib.dom declares `matchMedia` as always present, so a plain falsy check
// is flagged as an impossible condition.
if (
  typeof window !== "undefined" &&
  (window.matchMedia as unknown) === undefined
) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Testing Library appends rendered output to document.body for each test;
// without explicit cleanup, queries from one test leak into the next.
afterEach(() => {
  cleanup();
});
