//  @ts-check

import rootConfig from "../../eslint.config.js";
import { tanstackConfig } from "@tanstack/eslint-config";
import checkFile from "eslint-plugin-check-file";
import jsxA11y from "eslint-plugin-jsx-a11y";
import playwright from "eslint-plugin-playwright";
import vitest from "@vitest/eslint-plugin";

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
  "analytics",
  "audit",
  "auth",
  "calendar",
  "club-feedback",
  "feedback",
  "gazette",
  "gear",
  "history",
  "landing",
  "members",
  "settings",
  "sponsors",
  "trips",
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
    //      UserMenu + ViewAsMenu.
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
  /**
   * #291: no statement may bind a number of parameters that grows with
   * the data. D1 refuses past 100, and `inArray(col, list)` binds one per
   * element — the shape behind #259 and the 37 unbounded sites #291's
   * audit found. A ban on the import, not a review checklist, because the
   * old shape is what anyone fluent in Drizzle writes by habit.
   *
   * The replacements live in `src/server/db/index.ts`: `inJsonArray` /
   * `notInJsonArray` for a list from the caller (one JSON parameter at any
   * length), `inSubquery` / `notInSubquery` for a list the database
   * already holds (typed to reject an array). Drizzle's relational-query
   * callback (`where: (t, { inArray }) => …`) bypasses an import ban, so
   * it is restricted by syntax as well.
   *
   * The one exemption is the test that pins D1's ceiling, which must
   * build exactly the statement this rule forbids.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/db/__tests__/d1-bound-params.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "drizzle-orm",
              importNames: ["inArray", "notInArray"],
              message:
                "Binds one D1 parameter per element (cap 100, #291). Use inJsonArray / notInJsonArray or inSubquery / notInSubquery from #/server/db.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ObjectPattern > Property[key.name=/^(inArray|notInArray)$/]",
          message:
            "Drizzle's relational-query inArray binds one D1 parameter per element (#291). Use inJsonArray from #/server/db.",
        },
      ],
    },
  },
  /**
   * Test-file lint. `@tanstack/eslint-config` pulls in neither of these
   * plugins (checked: it brings `@stylistic`, `import-x`, `n` and
   * `typescript-eslint`), so nothing was catching the class of mistake
   * that makes a test *pass while testing nothing*.
   *
   * These are deliberately narrow. The point is not style — it's the
   * handful of rules where a violation means the suite is lying about
   * what it covers, which is exactly what static analysis can see and a
   * green run cannot.
   */
  {
    files: ["src/**/__tests__/**/*.{ts,tsx}"],
    plugins: { vitest },
    rules: {
      // A stray `.only` silently reduces a 1,576-test suite to one test
      // and still reports success. This is the single highest-value rule
      // here: CI goes green, and nothing about the output says that
      // everything else was skipped.
      "vitest/no-focused-tests": "error",
      // `expect(x).toBe` with no call, `expect(x)` with no matcher, an
      // `await` missing from an async matcher — each one typechecks and
      // asserts nothing.
      //
      // `maxArgs: 2` is required, not a relaxation. The rule is derived
      // from the Jest one, where `expect` takes a single argument; Vitest
      // accepts `expect(value, message)` and this suite leans on it
      // heavily to explain *why* a failure matters. At the default of 1
      // the rule reports every one of those as an error.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      // An assertion inside `if`/`catch` is skipped when the branch isn't
      // taken, so the test passes whether or not the thing it describes
      // happened.
      "vitest/no-conditional-expect": "error",
      // A test body with no assertion at all. Usually a refactor that
      // moved the assertion out and left the test behind.
      //
      // `assertFunctionNames` has to name any shared helper that asserts
      // on the caller's behalf, or the rule reports every test using one.
      // Keep this list short: each entry is a promise that the named
      // function always asserts.
      "vitest/expect-expect": [
        "error",
        { assertFunctionNames: ["expect", "expectInvalidates"] },
      ],
      // `node:test`'s `test`/`describe` shadow Vitest's with an API that
      // looks identical and reports to a runner that isn't running.
      "vitest/no-import-node-test": "error",
    },
  },
  {
    files: ["e2e/**/*.ts"],
    plugins: { playwright },
    rules: {
      // The defining Playwright mistake: a missing `await` on an
      // assertion. `expect(locator).toBeVisible()` without it returns a
      // promise nobody waits on, so the assertion resolves after the test
      // has already passed — and it passes whether or not the element was
      // ever there.
      "playwright/missing-playwright-await": "error",
      // `.only` in a spec, same reasoning as `vitest/no-focused-tests`,
      // except CI also sets `forbidOnly` — so this turns a red CI run
      // into a lint error caught before the push.
      "playwright/no-focused-test": "error",
      // Fixed sleeps are the flake source this suite already has an
      // answer for: `waitForHydration` polls real state. A
      // `waitForTimeout` is both slower than it needs to be and wrong on
      // a loaded runner.
      "playwright/no-wait-for-timeout": "error",
      // An `expect` with no matcher, and conditional assertions — the
      // same "passes while asserting nothing" shape as the vitest rules.
      "playwright/valid-expect": "error",
      "playwright/no-conditional-expect": "error",
    },
  },
  {
    // Vendored shadcn catalog. The CLI writes these files and `shadcn
    // add`/`diff` rewrites them wholesale, so they are kept byte-close
    // to upstream — the same reason they carry an `entry` in
    // knip.config.ts and an exclusion in the coverage config.
    //
    // Upstream's components consistently destructure `className` and
    // `...props` inside nested subcomponents while the file's own
    // prop types declare them at the top, so `no-shadow` fires on
    // ordinary catalog code. Renaming them is a diff against upstream
    // that the next `shadcn diff` reports forever; the rule is off
    // here instead. It stays on everywhere else, which is where it
    // catches anything.
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "no-shadow": "off",
    },
  },
  {
    // Build-time CLI scripts, run by `prepare:assets` from a terminal.
    // Their output IS the interface — `generate-sitemap` reports the
    // path it wrote and `sync-zxing-wasm` reports which WASM binary it
    // copied, which is how a stale `zxing_reader.wasm` gets noticed.
    // They never run in a Worker, so `server/log/log.server.ts` (which
    // logs to Workers Logs and imports `cloudflare:workers`) is the
    // wrong tool.
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Playwright's global setup, same category as the CLI scripts
    // above: it runs from a terminal and its output is the interface.
    // It deletes the previous run's seeded users, and a sweep that
    // removes several hundred rows without saying so is a worse
    // default than one line on stdout.
    files: ["e2e/global-setup.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    ignores: ["eslint.config.js"],
  },
];
