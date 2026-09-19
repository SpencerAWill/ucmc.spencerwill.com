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
 *   - A model is created inline from the add-gear sheet, since an item
 *     now references a product rather than carrying the brand itself.
 *   - Adding a piece with a code stores it; retiring it KEEPS the code,
 *     and re-adding the same code on a new piece is refused. Codes are
 *     never recycled, so every historical mention of one resolves to
 *     exactly one item.
 *   - The status filter on `/gear` toggles between active and retired
 *     rows.
 */
test("officer creates a type, adds gear, retires it, and cannot reissue the code", async ({
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

  // ── 1. Create a gear type via the /gear "Types" dialog ───────────────
  await page.goto("/gear");
  await waitForHydration(page);
  await page.getByRole("button", { name: /^types$/i }).click();
  await page.getByRole("button", { name: /new type/i }).click();
  await page.getByRole("textbox", { name: /^name$/i }).fill(typeName);
  await page.getByRole("textbox", { name: /prefix.*optional/i }).fill(prefix);
  await page.getByRole("button", { name: /create type/i }).click();
  // Form returns to the list pane; the new type's name should appear
  // inside the dialog. Scope to the dialog so the success toast (which
  // also embeds the type name) doesn't double-match strict-mode.
  await expect(page.getByRole("dialog").getByText(typeName)).toBeVisible();
  // Close the dialog so subsequent UI clicks aren't intercepted by it.
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: /^gear types$/i }),
  ).toBeHidden();

  // ── 2. Add a gear via /gear "Add gear" ───────────────────────────────
  await page.getByRole("button", { name: /^add gear$/i }).click();
  // Pick the freshly-created type.
  await page.getByRole("combobox", { name: /^type$/i }).click();
  await page.getByRole("option", { name: new RegExp(typeName) }).click();
  // The type has no models yet, so create one inline — an item can't
  // exist without the product it is an instance of.
  await page.getByRole("button", { name: /^new model/i }).click();
  await page
    .getByRole("textbox", { name: /^new model name$/i })
    .fill(`E2E Model ${runTag}`);
  await page
    .getByRole("textbox", { name: /^new model manufacturer$/i })
    .fill("Petzl");
  await page.getByRole("button", { name: /^create model$/i }).click();
  // Code auto-fills to "{prefix}1" via the suggest-code helper since
  // this is the type's first piece. Overwrite explicitly just to be
  // deterministic against the auto-fill effect's timing.
  const codeInput = page.getByRole("textbox", { name: /^code$/i });
  await codeInput.fill(code);
  // Optional now that the model carries the product name — this field
  // is only for per-unit distinguishing marks.
  await page
    .getByRole("textbox", { name: /distinguishing marks/i })
    .fill(`Test gear ${runTag}`);
  // The sheet's submit button reuses the "Add gear" label; the toolbar
  // button behind the sheet overlay is hidden, so the role lookup
  // resolves to the visible submit.
  await page.getByRole("button", { name: /^add gear$/i }).click();

  // The success toast confirms the create; the list row appears once
  // the GEAR_QUERY_KEY invalidates.
  await expect(page.getByText(new RegExp(`Added ${code}`, "i"))).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(code).first()).toBeVisible();

  // ── 3. Retire the gear ───────────────────────────────────────────────
  // Open the gear card's per-row actions dropdown and pick Retire.
  // (Actions live in a dropdown menu, not as a direct button on the
  // card, so the layout stays compact regardless of tag count.)
  await page
    .getByRole("button", { name: new RegExp(`Actions for ${code}`, "i") })
    .click();
  await page.getByRole("menuitem", { name: /retire/i }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`Retire ${code}`, "i") }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^retire$/i }).click();
  await expect(page.getByText(`${code} retired`)).toBeVisible({
    timeout: 5_000,
  });

  // The row leaves the active list (default status filter = active).
  await expect(page.getByText(code).first()).toBeHidden();

  // Toggling the status filter to "retired" reveals the row — and it
  // STILL carries its code, which is the behaviour change: retirement
  // used to NULL it. Status lives in the Filters popover as a radio
  // group since the multi-view refactor.
  await page.getByRole("button", { name: /^filters/i }).click();
  await page.getByRole("radio", { name: /^retired$/i }).check();
  await page.keyboard.press("Escape");
  await expect(page.getByText(typeName).first()).toBeVisible();
  await expect(page.getByText(code).first()).toBeVisible();

  // ── 4. The code cannot be reissued ──────────────────────────────────
  // Switch back to the active filter so a successful create would show.
  await page.getByRole("button", { name: /^filters/i }).click();
  await page.getByRole("radio", { name: /^active$/i }).check();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^add gear$/i }).click();
  await page.getByRole("combobox", { name: /^type$/i }).click();
  await page.getByRole("option", { name: new RegExp(typeName) }).click();
  await page.getByRole("combobox", { name: /^model$/i }).click();
  await page.getByRole("option", { name: /E2E Model/ }).click();
  await page.getByRole("textbox", { name: /^code$/i }).fill(code);
  await page
    .getByRole("textbox", { name: /distinguishing marks/i })
    .fill(`Reissued ${runTag}`);
  await page.getByRole("button", { name: /^add gear$/i }).click();

  // The retired piece still holds the unique index, so the save is
  // refused rather than silently rebinding the label to a second item.
  await expect(
    page.getByText(new RegExp(`"${code}" is already in use`, "i")),
  ).toBeVisible({ timeout: 5_000 });
});
