import type { KnipConfig } from "knip";

/**
 * Knip — dead-code, unused-export and unused-dependency detection.
 *
 * ESLint only sees unused *locals*. Knip works on the module graph, so it
 * catches the things ESLint structurally cannot: an exported function with
 * no importers, a file nobody imports, a dependency in `package.json` that
 * no longer appears in the source.
 *
 * The motivating case is the deliberately temporary code we've promised to
 * delete — `src/server/auth/permission-aliases.ts`, `LEGACY_SETTING_KEYS`,
 * `LEGACY_HERO_SETTING_KEYS`. Knip can't know when a migration has reached
 * prod, but it flags each shim the moment its last call site disappears,
 * which is the half of that cleanup we'd otherwise forget. All three still
 * have live call sites today, so none of them is listed below.
 *
 * Run with `pnpm --filter ucmc-web knip`. CI runs the same command.
 *
 * Every suppression below is deliberate and explained. Before adding one,
 * check whether the finding is real — the point of this file is to keep the
 * signal, not to silence it.
 */
const config: KnipConfig = {
  /**
   * Entry points. Most of this app's real entries are reached by
   * convention or configuration rather than by an import, so they have to
   * be declared or every one of them reports as an unused file.
   *
   * Deliberately NOT listed here, because knip's own plugins already
   * discover them and it flags a duplicate declaration as a config hint:
   *   - `src/server-entry.ts`  — via `main` in `wrangler.jsonc`
   *   - `src/start.ts`, `src/router.tsx` — via the TanStack Start plugin
   *   - `drizzle/schema.ts`, `drizzle/seed.ts` — via `drizzle.config.ts`
   *   - `playwright.config.ts`, `vite.config.ts`, the three vitest configs
   */
  entry: [
    // File-based routes are discovered by `@tanstack/router-plugin` and
    // compiled into `routeTree.gen.ts`; nothing imports them by hand.
    "src/routes/**/*.{ts,tsx}",

    // The Tailwind v4 stylesheet is the only importer of `tailwindcss`,
    // `tw-animate-css`, `@tailwindcss/typography` and `@fontsource/manrope`.
    // Without it as an entry those four report as unused dependencies.
    "src/styles.css",

    // The shadcn catalog (55 primitives) is vendored, not hand-written:
    // `pnpm dlx shadcn add` drops files in here and we keep the full set so
    // the CLI's add/update flow stays intact. Declaring the directory as
    // entry — rather than putting it in `ignore` — is deliberate: an unused
    // primitive is not reported, but knip still follows its imports, so the
    // packages only these files use (`input-otp`, `react-resizable-panels`,
    // `recharts`, `cmdk`, …) are still correctly seen as used.
    "src/components/ui/**/*.tsx",

    // Storybook stories and both vitest pools. Tests and stories are
    // entries, so an export used only by a test still counts as used —
    // that's intended: it keeps `src/test-support/auth-stub.ts` (imported
    // only from tests, and living under `src/` on purpose) off the report.
    "src/**/*.stories.tsx",
    "src/**/__tests__/**/*.test.{ts,tsx}",
    "test/*.ts",
    "e2e/**/*.ts",

    // Run by `pnpm generate:sitemap` (a `dev`/`build` prestep), not imported.
    "scripts/*.ts",

    ".storybook/*.ts",

    // Flat ESLint config: the only importer of `@tanstack/eslint-config`,
    // `eslint-plugin-check-file` and `eslint-plugin-jsx-a11y`.
    "eslint.config.js",
  ],

  project: [
    "src/**/*.{ts,tsx,css}",
    "test/**/*.ts",
    "e2e/**/*.ts",
    "drizzle/*.ts",
    "scripts/*.ts",
    ".storybook/*.ts",
    "*.{ts,js}",
  ],

  /**
   * Unused files: real findings, tracked for follow-up. Listed here rather
   * than deleted so this change stays a tooling change; deleting them is
   * its own reviewable commit.
   *
   * `src/routeTree.gen.ts` deliberately does NOT appear: it's generated and
   * committed, but `src/router.tsx` imports it, so it's a used file and
   * knip never reports it. Adding it here earns a "remove from ignore"
   * config hint.
   */
  ignore: [
    // Barrel file for the Storybook-only primitives; the stories import
    // each primitive directly, so nothing reads the barrel.
    "src/components/storybook/index.ts",
    // Superseded by the type/model/item rework (#213) — the gear type
    // editor moved into the model sheet.
    "src/features/gear/components/gear-type-form-sheet.tsx",
    // Client-side mirror of `suggestCodeForTypeAction`, written for a
    // preview UI that was never built.
    "src/features/gear/lib/suggest-code.ts",
  ],

  /**
   * An export consumed only inside its own file is live code with a
   * redundant `export` keyword, not dead code. Reporting those drowned the
   * genuine findings ~3:1 (79 reported, 26 real). Dropping the keyword is
   * worth doing, but it's a mechanical cleanup, not a correctness gate.
   */
  ignoreExportsUsedInFile: true,

  /**
   * `eslint` and `prettier` are workspace-root devDependencies; knip runs
   * scoped to this package and can't see the root manifest.
   */
  ignoreBinaries: ["eslint", "prettier"],

  ignoreDependencies: [
    // Not a package: `cloudflare:workers` is a synthetic module provided by
    // the workerd runtime. Knip reads the specifier's first segment as a
    // package name.
    "cloudflare",
    // Referenced by string ("typescript") in the flat config's
    // `settings["import/resolver"]`, never imported.
    "eslint-import-resolver-typescript",

    // ── Unused dependencies: real findings, tracked for follow-up. ───────
    // Each of these resolves to zero references in `src/`, `test/`, `e2e/`,
    // `drizzle/` or `scripts/`. Removing them is a separate commit so this
    // one doesn't touch the lockfile.
    "@faker-js/faker",
    "@tanstack/match-sorter-utils",
    "@tanstack/react-table",
    "@tanstack/react-virtual",
    // A transitive dep of `@tanstack/react-start`'s Vite plugin, which is
    // what actually generates the route tree. Our direct declaration is
    // redundant — nothing in this package imports it.
    "@tanstack/router-plugin",
    "@tiptap/extension-character-count",
  ],

  /**
   * Per-file suppressions for the remaining backlog. These are file-scoped
   * rather than symbol-scoped because that's the granularity knip offers,
   * so each entry names what it's covering — when the backlog is cleared,
   * delete the entry rather than leaving the file unguarded.
   */
  ignoreIssues: {
    // `clubFeedbackStatus` is a deliberate alias of `feedbackStatus`: the
    // two tables share a status vocabulary and each column reads with its
    // own name. Knip counts aliased re-exports as duplicates.
    "drizzle/schema.ts": ["duplicates"],

    // Repository helpers written ahead of the callers that were meant to
    // use them, plus a few whose callers were removed by later reworks.
    // Candidates for deletion, but each needs a look at whether the caller
    // is merely pending.
    "src/features/album/server/album-fns.ts": ["exports"],
    "src/features/announcements/server/repo.server.ts": ["exports"],
    "src/features/gazette/server/gazette-repo.server.ts": ["exports"],
    "src/features/gear/server/models-repo.server.ts": ["exports"],
    "src/features/gear/server/repo.server.ts": ["exports"],
    "src/features/landing/server/landing-repo.server.ts": ["exports"],
    "src/features/volunteer/server/volunteer-repo.server.ts": ["exports"],
    "src/server/markdown-pages/markdown-pages-repo.server.ts": ["exports"],

    // Query-option factories and mutation hooks with no current caller.
    "src/features/gear/api/queries.ts": ["exports"],
    "src/features/waivers/api/queries.ts": ["exports"],
    "src/features/waivers/api/use-attest-waiver.ts": ["exports"],

    // Form-field wrappers (`Slider`, `Switch`) built out for completeness
    // of the field set; no form uses them yet.
    "src/lib/form/fields.tsx": ["exports"],

    // Default export re-exported through a named export that IS used; knip
    // reports the unreferenced `default` half.
    "src/lib/tanstack-query/root-provider.tsx": ["exports"],

    "src/features/landing/lib/hero-pages.ts": ["exports"],
    "src/features/landing/server/landing-schemas.ts": ["exports", "types"],

    // Feature-shell public API surface. `*-fns.ts` re-exports the input and
    // result types alongside the server-fn shells so routes can name them
    // without reaching past the boundary (`import/no-restricted-paths`).
    // Some have no consumer yet; the re-export set is intentionally the
    // whole surface rather than whatever happens to be imported today.
    "src/features/announcements/server/limits.ts": ["types"],
    "src/features/auth/server/email-fns.ts": ["types"],
    "src/features/auth/server/server-fns.ts": ["types"],
    "src/features/feedback/server/limits.ts": ["types"],
    "src/features/gear/server/gear-fns.ts": ["exports", "types"],
    "src/features/members/server/member-fns.ts": ["types"],
    "src/features/settings/server/settings-fns.ts": ["exports", "types"],
  },
};

export default config;
