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
    // Bulletproof React's unidirectional architecture, mechanically
    // enforced. Three rules:
    //   1. Features don't import other features. Compose at the route
    //      level. The narrow exception is auth's public API
    //      (api/use-auth, api/view-mode, guards.ts) — every feature
    //      legitimately needs to ask "who is the user / what can they
    //      do" and these surfaces are auth's contract for that. All
    //      other features/auth/** internals — magic-link, webauthn,
    //      sign-in UI, server-fns shells — stay private.
    //   2. Shared utilities can't reach into features. components/ui,
    //      lib, hooks, config are feature-blind primitives.
    //      components/layouts/ is intentionally NOT scoped here because
    //      AppLayout is app-shell territory and legitimately renders
    //      AnnouncementsBell + UserMenu.
    //   3. Features can't import routes. Routes compose features, not
    //      the reverse.
    //
    // Settings: import-x's resolver follows tsconfig path aliases, so
    // `#/features/...` actually resolves to a path the zone matcher can
    // compare against. Without it, import-x just sees the literal
    // alias string and the rule silently no-ops.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**"],
    settings: {
      "import-x/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          // `except` paths are relative to the zone's `from` and carve
          // out the foundational auth public API. Adding to this list
          // is a flag to consider hoisting that surface to a truly
          // shared location instead.
          zones: [
            // 1. No cross-feature imports.
            //    features/auth's public API (use-auth, view-mode,
            //    guards) is exempted because it's the foundational
            //    "who is the user" surface every feature needs.
            {
              target: "./src/features/announcements",
              from: "./src/features/auth",
              except: [
                "./api/use-auth.ts",
                "./api/view-mode.tsx",
                "./guards.ts",
              ],
            },
            {
              target: "./src/features/announcements",
              from: "./src/features/members",
            },
            {
              target: "./src/features/auth",
              from: "./src/features/announcements",
            },
            {
              target: "./src/features/auth",
              from: "./src/features/members",
            },
            {
              target: "./src/features/members",
              from: "./src/features/auth",
              except: [
                "./api/use-auth.ts",
                "./api/view-mode.tsx",
                "./guards.ts",
              ],
            },
            {
              target: "./src/features/members",
              from: "./src/features/announcements",
            },
            {
              target: "./src/features/announcements",
              from: "./src/features/feedback",
            },
            {
              target: "./src/features/members",
              from: "./src/features/feedback",
            },
            {
              target: "./src/features/auth",
              from: "./src/features/feedback",
            },
            {
              target: "./src/features/feedback",
              from: "./src/features/auth",
              except: [
                "./api/use-auth.ts",
                "./api/view-mode.tsx",
                "./guards.ts",
              ],
            },
            {
              target: "./src/features/feedback",
              from: "./src/features/announcements",
            },
            {
              target: "./src/features/feedback",
              from: "./src/features/members",
            },
            // 2. Shared can't import features
            { target: "./src/components/ui", from: "./src/features" },
            { target: "./src/components/profile", from: "./src/features" },
            { target: "./src/lib", from: "./src/features" },
            { target: "./src/hooks", from: "./src/features" },
            { target: "./src/config", from: "./src/features" },
            // 3. Features can't import routes
            { target: "./src/features", from: "./src/routes" },
          ],
        },
      ],
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
