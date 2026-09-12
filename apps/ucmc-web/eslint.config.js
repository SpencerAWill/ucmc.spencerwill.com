//  @ts-check

import rootConfig from "../../eslint.config.js";
import { tanstackConfig } from "@tanstack/eslint-config";
import checkFile from "eslint-plugin-check-file";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * Anchor a zone path to this config file rather than to the process cwd.
 *
 * `import/no-restricted-paths` resolves a relative `target` / `from`
 * against `process.cwd()`. The zones were written as `./src/features/...`,
 * which is correct under `pnpm --filter ucmc-web lint` (cwd is this
 * package, which is how CI runs it) but resolves to `<repo>/src/features/...`
 * — a path that doesn't exist — under the `pnpm exec eslint .` documented
 * in CLAUDE.md's Commands section. A zone whose paths match nothing fails
 * open: the rule silently passes instead of erroring, so the boundary
 * check appears to run and enforces nothing.
 *
 * The resolver's `project` path below has the same problem and has to be
 * anchored too — an unresolvable `#/features/...` specifier also fails
 * open. Both are needed for the rule to behave the same from either
 * directory; fixing one alone changes nothing.
 */
const zonePath = (rel) => new URL(rel, import.meta.url).pathname;

/**
 * Every feature directory under `src/features/`. **This list is the whole
 * change when a feature is added** — the pairwise `import/no-restricted-paths`
 * zones below are generated from it.
 *
 * It used to be 62 hand-written zone objects, which drifted badly: by the
 * time this was generated, `album`, `gazette`, `gear`, `history` and
 * `settings` had no zones at all, so the cross-feature import rule that
 * CLAUDE.md documents wasn't actually enforced for any feature added after
 * `club-feedback`. Generating the pairs is what makes "add a feature, get
 * the boundary" true rather than aspirational.
 */
const FEATURES = [
  "album",
  "announcements",
  "audit",
  "auth",
  "club-feedback",
  "feedback",
  "gazette",
  "gear",
  "history",
  "landing",
  "members",
  "settings",
  "volunteer",
  "waivers",
];

/**
 * The surfaces a feature publishes to its siblings, keyed by the feature
 * being imported *from*. Everything else under that feature stays private.
 *
 * Only two features have one, and both are foundational rather than
 * convenient:
 *
 *   - `auth` answers "who is the user and what may they do". Every feature
 *     legitimately asks that; the sign-in UI, magic-link and webauthn
 *     internals behind it stay private. `guards.ts` is included because
 *     route guards compose at the feature level.
 *   - `settings` answers "what is this site configured to show" —
 *     `publicFlagsQueryOptions` (page kill switches) and
 *     `publicSiteContactQueryOptions` (club email, socials). Four features
 *     already read it, and a nav entry that can't see a page flag renders
 *     a link that 404s. Only `api/queries.ts` is public; the settings
 *     registry, repo, and admin UI are not.
 *
 * Adding a third entry here is a signal to consider hoisting that surface
 * out of `src/features/` entirely, the way `use-image-crop` went to
 * `src/hooks/` and the curated icon registry went to `src/components/`.
 */
const FEATURE_PUBLIC_API = {
  auth: ["./api/use-auth.ts", "./api/view-mode.tsx", "./guards.ts"],
  settings: ["./api/queries.ts"],
};

/**
 * One-off carve-outs the blanket public API doesn't cover, keyed
 * `"<target> <- <from>"` — i.e. "<target> may additionally import these
 * paths from <from>". Each one is a deliberate, documented crack in the
 * wall, not a convenience.
 */
const ZONE_EXCEPTIONS = {
  // `requireCurrentWaiver` composes auth state with waiver state, so
  // features/auth's guards.ts reads the waiver query options. The server-fn
  // shell is deliberately NOT listed: `import/no-restricted-paths` can't
  // tell `import type` from a value import, so allowlisting it would
  // silently permit value-imports of runtime exports. Types ride along
  // through api/queries.ts re-exports instead.
  "auth <- waivers": ["./api/queries.ts"],
  // The role-update hook invalidates the landing-content query cache when a
  // role's displayName / isOfficer changes — those surface on the public
  // home page. Carving out the key constant beats hand-rolling a brittle
  // string literal in features/members.
  "members <- landing": ["./api/query-keys.ts"],
};

/**
 * Features don't import features. Compose at the route level.
 *
 * Generated as every ordered pair, so a new entry in FEATURES is
 * immediately fenced in both directions with no further edits.
 */
const featureZones = FEATURES.flatMap((target) =>
  FEATURES.filter((from) => from !== target).map((from) => {
    // A named exception replaces the public API rather than extending it:
    // the two that exist are for features with no public API of their own.
    const except =
      ZONE_EXCEPTIONS[`${target} <- ${from}`] ?? FEATURE_PUBLIC_API[from];
    return {
      target: zonePath(`src/features/${target}`),
      from: zonePath(`src/features/${from}`),
      // `except` entries stay relative — import-x resolves them against
      // the zone's own `from`, not the cwd.
      ...(except ? { except } : {}),
    };
  }),
);

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
    //      level. Generated from FEATURES / FEATURE_PUBLIC_API /
    //      ZONE_EXCEPTIONS above — see those for the exceptions and
    //      why each exists.
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
    // alias string and the rule silently no-ops — which is a failure
    // mode worth remembering, because it is indistinguishable from
    // "the code is clean" in CI output.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**"],
    settings: {
      // Absolute, for the same reason the zone paths are: a
      // cwd-relative "./tsconfig.json" resolves to <repo>/tsconfig.json
      // under `pnpm exec eslint .`, the resolver then can't resolve
      // `#/features/...`, and every zone silently stops matching.
      "import-x/resolver": {
        typescript: { project: zonePath("tsconfig.json") },
      },
      "import/resolver": {
        typescript: { project: zonePath("tsconfig.json") },
      },
    },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            // 1. No cross-feature imports — see FEATURES,
            //    FEATURE_PUBLIC_API and ZONE_EXCEPTIONS above.
            ...featureZones,
            // 2. Shared can't import features
            {
              target: zonePath("src/components/ui"),
              from: zonePath("src/features"),
            },
            {
              target: zonePath("src/components/profile"),
              from: zonePath("src/features"),
            },
            { target: zonePath("src/lib"), from: zonePath("src/features") },
            { target: zonePath("src/hooks"), from: zonePath("src/features") },
            { target: zonePath("src/config"), from: zonePath("src/features") },
            // 3. Features can't import routes
            { target: zonePath("src/features"), from: zonePath("src/routes") },
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
