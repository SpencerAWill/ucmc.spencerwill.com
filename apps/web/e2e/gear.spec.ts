import { ensureApprovedUser } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Officer drives the gear inventory UI end-to-end. Covers the wiring
 * that unit tests can't see together:
 *
 *   - Route guard on `/gear` lets the officer in (gear:read), and the
 *     write affordances appear because system_admin's bypass grants
 *     gear:manage.
 *   - Type creation lands in D1 and the type appears in the type
 *     dropdown when adding gear.
 *   - Adding a piece with a code stores it; retiring it NULLs the code;
 *     re-adding the same code on a new piece succeeds (the headline
 *     "code recycling" behavior of this feature).
 *   - The lifecycle filter on `/gear` toggles between active and
 *     retired rows.
 */
test("officer creates a type, adds gear, retires it, and reissues the code", async ({
  page,
  mailpit,
}) => {
  const officerEmail = `e2e-gear-officer-${Date.now()}@example.com`;
  ensureApprovedUser(officerEmail, { roles: ["role_system_admin"] });

  // Sign in via the magic-link flow.
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("textbox", { name: /email/i }).fill(officerEmail);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();
  const link = await mailpit.extractFirstLink(officerEmail);
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: /continue to ucmc/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/callback"), {
    timeout: 15_000,
  });

  // Unique-per-run identifiers so reruns against the same dev server
  // don't collide on the gear_types.name / gear.code UNIQUE constraints.
  const runTag = Date.now();
  const typeName = `E2E Harness ${runTag}`;
  const prefix = `EH${runTag.toString().slice(-3)}`; // 5 chars max
  const code = `${prefix}1`;

  // ── 1. Create a gear type via /gear/types ────────────────────────────
  await page.goto("/gear/types");
  await waitForHydration(page);
  await page.getByRole("button", { name: /new type/i }).click();
  await page.getByRole("textbox", { name: /^name$/i }).fill(typeName);
  await page.getByRole("textbox", { name: /prefix.*optional/i }).fill(prefix);
  await page.getByRole("button", { name: /create type/i }).click();
  await expect(page.getByText(typeName)).toBeVisible();

  // ── 2. Add a gear via /gear "Add gear" ───────────────────────────────
  await page.goto("/gear");
  await waitForHydration(page);
  await page.getByRole("button", { name: /^add gear$/i }).click();
  // Pick the freshly-created type.
  await page.getByRole("combobox", { name: /^type$/i }).click();
  await page.getByRole("option", { name: new RegExp(typeName) }).click();
  // Code auto-fills to "{prefix}1" via the suggest-code helper since
  // this is the type's first piece. Overwrite explicitly just to be
  // deterministic against the auto-fill effect's timing.
  const codeInput = page.getByRole("textbox", { name: /^code$/i });
  await codeInput.fill(code);
  await page.getByRole("button", { name: /^add gear$/i }).click();

  // The success toast confirms the create; the list row appears once
  // the GEAR_QUERY_KEY invalidates.
  await expect(page.getByText(new RegExp(`Added ${code}`, "i"))).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(code).first()).toBeVisible();

  // ── 3. Retire the gear ───────────────────────────────────────────────
  // Find the gear card and click its retire button.
  const card = page.locator("li", { hasText: code }).first();
  await card.getByRole("button", { name: /retire/i }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`Retire ${code}`, "i") }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^retire$/i }).click();
  await expect(page.getByText(`${code} retired`)).toBeVisible({
    timeout: 5_000,
  });

  // The row leaves the active list (default lifecycle filter = active).
  await expect(page.getByText(code).first()).toBeHidden();

  // Toggling the lifecycle filter to "retired" reveals the row, with
  // its code now cleared from the database — so the card shows the
  // "no code" placeholder. Verify the type name renders on a retired row.
  await page.getByRole("combobox", { name: /active/i }).click();
  await page.getByRole("option", { name: /^retired$/i }).click();
  await expect(page.getByText(typeName).first()).toBeVisible();

  // ── 4. Re-issue the freed code on a brand-new piece ──────────────────
  // Switch back to active filter so the new piece shows up immediately.
  await page.getByRole("combobox", { name: /retired/i }).click();
  await page.getByRole("option", { name: /^active$/i }).click();

  await page.getByRole("button", { name: /^add gear$/i }).click();
  await page.getByRole("combobox", { name: /^type$/i }).click();
  await page.getByRole("option", { name: new RegExp(typeName) }).click();
  // The suggested code returns to the same value since the old piece's
  // code is NULL — type now has zero active codes again. Explicitly
  // refill to keep the assertion independent of the suggester.
  await page.getByRole("textbox", { name: /^code$/i }).fill(code);
  await page.getByRole("button", { name: /^add gear$/i }).click();

  await expect(page.getByText(new RegExp(`Added ${code}`, "i"))).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(code).first()).toBeVisible();
});
