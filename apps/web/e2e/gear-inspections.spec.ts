import { randomUUID } from "node:crypto";

import { ensureApprovedUser, execD1 } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Officer logs an inspection on a single piece of gear and sees the
 * row land in the detail-page inspection log.
 *
 * Seeded directly via D1 — exercises the inspection-log UI in
 * isolation from the gear-creation flow (which is covered in its own
 * e2e spec).
 */
test("officer records an inspection and sees it on the gear detail page", async ({
  page,
  mailpit,
}) => {
  const officerEmail = `e2e-inspect-${Date.now()}@example.com`;
  ensureApprovedUser(officerEmail, { roles: ["role_system_admin"] });

  // Seed a gear type and one gear row directly. Public IDs follow the
  // 12-char alphanumeric shape the app generates via nanoid; tests
  // don't need cryptographic uniqueness, only per-run uniqueness.
  const runTag = Date.now();
  const typeId = `gt_${randomUUID()}`;
  const typePublicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const gearId = `g_${randomUUID()}`;
  const gearPublicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const typeName = `E2E Inspect Harness ${runTag}`;
  const code = `EI${runTag.toString().slice(-4)}`;

  execD1(`
INSERT INTO gear_types (id, public_id, name, prefix, created_at, updated_at)
VALUES ('${typeId}', '${typePublicId}', '${typeName}', 'EI', ${runTag}, ${runTag});
INSERT INTO gear (id, public_id, type_id, code, description, lifecycle, condition, created_at, updated_at)
VALUES ('${gearId}', '${gearPublicId}', '${typeId}', '${code}', 'Inspection target', 'active', 'serviceable', ${runTag}, ${runTag});
`);

  // Sign in via magic link.
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

  // Go to the gear detail page.
  await page.goto(`/gear/${gearPublicId}`);
  await waitForHydration(page);

  // Initial state: empty inspection log.
  await expect(page.getByText(/no inspections recorded/i)).toBeVisible();

  // Open the dialog, pick "Fail" + a note, submit.
  await page.getByRole("button", { name: /log inspection/i }).click();
  await expect(
    page.getByRole("heading", { name: /log inspection/i }),
  ).toBeVisible();
  await page.getByRole("radio", { name: /fail/i }).check();
  const notes = `Fail note ${runTag}`;
  await page.getByRole("textbox", { name: /notes/i }).fill(notes);
  await page.getByRole("button", { name: /record inspection/i }).click();

  // Success toast confirms the mutation landed.
  await expect(page.getByText(/inspection recorded/i)).toBeVisible({
    timeout: 5_000,
  });
  // Wait for the dialog to close before asserting on the log row — the
  // textarea inside the dialog ALSO carries the notes string until the
  // dialog is gone, which would trip a strict-mode locator violation.
  await expect(
    page.getByRole("heading", { name: /log inspection/i }),
  ).toBeHidden({ timeout: 5_000 });
  // Now the log row is the only thing on the page with this text.
  await expect(page.getByText(notes)).toBeVisible({ timeout: 5_000 });
  // The "no inspections" placeholder is gone.
  await expect(page.getByText(/no inspections recorded/i)).toBeHidden();
});
