//  @ts-check

import rootConfig from "../../eslint.config.js";
import { tanstackConfig } from "@tanstack/eslint-config";
import checkFile from "eslint-plugin-check-file";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  ...rootConfig,
  ...tanstackConfig,
  {
    // Accessibility lint, scoped to TSX (the only place JSX appears).
    // Promotes a curated set of jsx-a11y rules to error so CI gates on
    // them. The plugin's full recommended config is available as
    // `jsxA11y.flatConfigs.recommended` if we want to widen the net
    // later, but the explicit list below is what's been audited and
    // intentionally enforced — picking up new rules implicitly on a
    // plugin upgrade isn't desirable for a CI gate.
    files: ["**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/img-redundant-alt": "error",
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
    },
  },
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
            //    features/waivers' public API (api/queries.ts) is
            //    exempted only for features/auth, because the
            //    `requireCurrentWaiver` route guard composes auth +
            //    waiver state and lives in features/auth/guards.ts.
            //    The server-fn shell is intentionally NOT on the
            //    allowlist: `import/no-restricted-paths` can't tell
            //    `import type` from value imports, so allowlisting it
            //    would silently permit value-imports of runtime
            //    exports. Types ride along through api/queries.ts
            //    re-exports instead.
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
              target: "./src/features/announcements",
              from: "./src/features/waivers",
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
              target: "./src/features/auth",
              from: "./src/features/waivers",
              except: ["./api/queries.ts"],
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
              target: "./src/features/members",
              from: "./src/features/waivers",
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
            // features/audit (audit-log viewer) is a fully-isolated
            // admin-only feature: no other feature reads from it, and
            // it doesn't depend on any other feature (the recorder
            // it pairs with lives in src/server/audit/ — shared).
            {
              target: "./src/features/announcements",
              from: "./src/features/audit",
            },
            {
              target: "./src/features/auth",
              from: "./src/features/audit",
            },
            {
              target: "./src/features/feedback",
              from: "./src/features/audit",
            },
            {
              target: "./src/features/members",
              from: "./src/features/audit",
            },
            {
              target: "./src/features/waivers",
              from: "./src/features/audit",
            },
            {
              target: "./src/features/audit",
              from: "./src/features/announcements",
            },
            {
              target: "./src/features/audit",
              from: "./src/features/auth",
            },
            {
              target: "./src/features/audit",
              from: "./src/features/feedback",
            },
            {
              target: "./src/features/audit",
              from: "./src/features/members",
            },
            {
              target: "./src/features/audit",
              from: "./src/features/waivers",
            },
            {
              target: "./src/features/feedback",
              from: "./src/features/waivers",
            },
            {
              target: "./src/features/waivers",
              from: "./src/features/announcements",
            },
            {
              target: "./src/features/waivers",
              from: "./src/features/auth",
            },
            {
              target: "./src/features/waivers",
              from: "./src/features/feedback",
            },
            {
              target: "./src/features/waivers",
              from: "./src/features/members",
            },
            // features/landing (homepage CMS) is fully isolated from
            // every other feature except for read-access to auth's
            // public API (the inline `<EditAffordance>` admin widget
            // gates on `useAuth()`).
            {
              target: "./src/features/announcements",
              from: "./src/features/landing",
            },
            {
              target: "./src/features/audit",
              from: "./src/features/landing",
            },
            {
              target: "./src/features/auth",
              from: "./src/features/landing",
            },
            {
              target: "./src/features/feedback",
              from: "./src/features/landing",
            },
            {
              target: "./src/features/members",
              from: "./src/features/landing",
              // The role-update hook invalidates the landing-content
              // query cache when a role's displayName / isOfficer
              // changes — those fields surface on the public home page.
              // Carve out the query-key constant so the hook doesn't
              // hand-roll a brittle string literal.
              except: ["./api/query-keys.ts"],
            },
            {
              target: "./src/features/waivers",
              from: "./src/features/landing",
            },
            {
              target: "./src/features/landing",
              from: "./src/features/announcements",
            },
            {
              target: "./src/features/landing",
              from: "./src/features/audit",
            },
            {
              target: "./src/features/landing",
              from: "./src/features/auth",
              except: [
                "./api/use-auth.ts",
                "./api/view-mode.tsx",
                "./guards.ts",
              ],
            },
            {
              target: "./src/features/landing",
              from: "./src/features/feedback",
            },
            {
              target: "./src/features/landing",
              from: "./src/features/members",
            },
            {
              target: "./src/features/landing",
              from: "./src/features/waivers",
            },
            // features/club-feedback (governance feedback) is fully
            // isolated from every other feature except for read access
            // to auth's public API (the standard exception). It pairs
            // with features/feedback but they intentionally do NOT
            // depend on each other — the shared tab bar lives in
            // src/components/layouts so neither feature has to.
            {
              target: "./src/features/announcements",
              from: "./src/features/club-feedback",
            },
            {
              target: "./src/features/audit",
              from: "./src/features/club-feedback",
            },
            {
              target: "./src/features/auth",
              from: "./src/features/club-feedback",
            },
            {
              target: "./src/features/feedback",
              from: "./src/features/club-feedback",
            },
            {
              target: "./src/features/landing",
              from: "./src/features/club-feedback",
            },
            {
              target: "./src/features/members",
              from: "./src/features/club-feedback",
            },
            {
              target: "./src/features/waivers",
              from: "./src/features/club-feedback",
            },
            {
              target: "./src/features/club-feedback",
              from: "./src/features/announcements",
            },
            {
              target: "./src/features/club-feedback",
              from: "./src/features/audit",
            },
            {
              target: "./src/features/club-feedback",
              from: "./src/features/auth",
              except: [
                "./api/use-auth.ts",
                "./api/view-mode.tsx",
                "./guards.ts",
              ],
            },
            {
              target: "./src/features/club-feedback",
              from: "./src/features/feedback",
            },
            {
              target: "./src/features/club-feedback",
              from: "./src/features/landing",
            },
            {
              target: "./src/features/club-feedback",
              from: "./src/features/members",
            },
            {
              target: "./src/features/club-feedback",
              from: "./src/features/waivers",
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
