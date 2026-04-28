//  @ts-check

import rootConfig from "../../eslint.config.js";
import { tanstackConfig } from "@tanstack/eslint-config";
import checkFile from "eslint-plugin-check-file";

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
    files: ["src/**/*.{ts,tsx}"],
    // Routes use TanStack Router's special filename syntax (`__root`,
    // `$param`, dot separators, trailing underscores), and `routeTree.gen.ts`
    // is generated. Both are exempt from kebab-case enforcement.
    ignores: ["src/routes/**", "src/routeTree.gen.ts"],
    plugins: { "check-file": checkFile },
    rules: {
      "check-file/filename-naming-convention": [
        "error",
        { "**/*.{ts,tsx}": "KEBAB_CASE" },
        { ignoreMiddleExtensions: true },
      ],
    },
  },
  {
    // Folder rule is separate so we can additionally exempt `__tests__/`
    // (the standard Vitest/Jest convention) without disabling the filename
    // rule for test files.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/routes/**", "src/routeTree.gen.ts", "**/__tests__/**"],
    plugins: { "check-file": checkFile },
    rules: {
      "check-file/folder-naming-convention": [
        "error",
        { "src/**/": "KEBAB_CASE" },
      ],
    },
  },
  {
    ignores: ["eslint.config.js"],
  },
];
