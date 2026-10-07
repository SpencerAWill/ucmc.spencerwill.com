import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural guard over EVERY mutation hook, not just the few with
 * behavioural tests.
 *
 * CLAUDE.md: "Inline `useMutation` in routes/components is forbidden —
 * every mutation has a `use-*.ts` hook with a fixed cache-invalidation
 * contract." There are 98 such hooks. Asserting each one's exact key set
 * is worth doing where the keys are subtle (see
 * `features/waivers/api/__tests__/invalidation-contract.test.tsx` for
 * that pattern), but it will never cover all 98, and the cheapest
 * failure to catch is the categorical one: a hook that manages no cache
 * at all.
 *
 * That hook leaves the UI showing stale data after a successful write,
 * with no error anywhere — the officer attests a waiver, the row stays
 * in the queue, and they attest it again.
 *
 * This reads source rather than executing it on purpose. Importing 98
 * hooks to inspect them would need every server-fn module mocked and
 * would still only observe the ones a test remembered to invoke.
 */

const ROOT = join(import.meta.dirname, "..", "..");

/** Any cache operation counts — invalidation is the common one, not the only valid one. */
const CACHE_OPERATION =
  /invalidateQueries|setQueryData|removeQueries|resetQueries|queryClient\.clear\(/;

/**
 * Mutation hooks that deliberately touch no cache.
 *
 * Self-clearing, like `KNOWN_NULLABILITY_DRIFT` in
 * `schema-drift.test.ts`: the test asserts an allowlisted hook STILL has
 * no cache operation, so adding one fails with "remove this entry"
 * rather than leaving the hook permanently unguarded.
 */
const NO_CACHE_BY_DESIGN: Record<string, string | undefined> = {
  "src/features/auth/api/use-request-magic-link.ts":
    "sends an email; nothing server-side that is cached has changed yet",
  "src/features/auth/api/use-add-email.ts":
    "the address is not attached until the link is consumed — `/verify-email` invalidates on its own success",
};

// `readdirSync(..., { recursive: true })` rather than a glob package:
// this is the only place in the repo that needs one, and adding a
// dependency to find files is a poor trade when Node does it.
const mutationHooks = readdirSync(join(ROOT, "src"), { recursive: true })
  .map(String)
  .filter((rel) => {
    const base = rel.split("/").pop() ?? "";
    return base.startsWith("use-") && base.endsWith(".ts");
  })
  .map((rel) => {
    const file = `src/${rel}`;
    return { file, source: readFileSync(join(ROOT, file), "utf8") };
  })
  .filter(({ source }) => source.includes("useMutation"))
  .sort((a, b) => a.file.localeCompare(b.file));

describe("every mutation hook has a cache contract", () => {
  it("found the hooks to check", () => {
    // Anti-vacuity guard. A glob that stopped matching — a directory
    // rename, a move off `src/` — would make this file pass having
    // checked nothing, which is indistinguishable from a clean result.
    expect(
      mutationHooks.length,
      "the mutation-hook glob matched suspiciously few files",
    ).toBeGreaterThan(80);
  });

  it.each(mutationHooks.map(({ file }) => file))("%s", (file) => {
    const { source } = mutationHooks.find((h) => h.file === file)!;
    const reason = NO_CACHE_BY_DESIGN[file];
    const touchesCache = CACHE_OPERATION.test(source);

    // Stated as a single expectation rather than two branches so the
    // assertion can't be skipped (`vitest/no-conditional-expect`), and
    // so an allowlisted hook that GAINS a cache operation fails too.
    expect(
      touchesCache,
      reason
        ? `${file} is allowlisted as cache-free (${reason}) but now manages a cache — remove its NO_CACHE_BY_DESIGN entry`
        : `${file} calls useMutation but never invalidates, sets, removes or clears a query cache. ` +
            `A successful write there leaves stale data on screen with no error. ` +
            `If that is genuinely correct, add it to NO_CACHE_BY_DESIGN with the reason.`,
    ).toBe(reason === undefined);
  });
});
