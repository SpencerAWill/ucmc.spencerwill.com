import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library appends rendered output to document.body for each test;
// without explicit cleanup, queries from one test leak into the next.
afterEach(() => {
  cleanup();
});
