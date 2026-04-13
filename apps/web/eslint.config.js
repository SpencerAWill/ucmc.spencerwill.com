//  @ts-check

import rootConfig from "../../eslint.config.js";
import { tanstackConfig } from "@tanstack/eslint-config";

export default [
  ...rootConfig,
  ...tanstackConfig,
  {
    // Disable core JS-only rules that conflict with TypeScript on TS/TSX
    // files — typescript-eslint (via the tanstack config) covers these with
    // TS-aware equivalents (or TS itself handles them at compile time).
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off", // TypeScript's type checker handles this
      "no-duplicate-imports": "off", // allow separate type-only imports; use import/no-duplicates instead
      "no-unused-vars": "off", // @typescript-eslint/no-unused-vars supersedes this
    },
  },
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "pnpm/json-enforce-catalog": "off",
    },
  },
  {
    ignores: ["eslint.config.js"],
  },
];
