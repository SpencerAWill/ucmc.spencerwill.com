import type { Page } from "@playwright/test";

import { ensureApprovedUser, execD1 } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * End-to-end coverage for the ban / unban feature. Exercises the parts
 * that unit tests can't reach because they cross the
 * action ↔ Worker ↔ browser ↔ Mailpit boundary:
 *
 *   1. Officer drives the Ban dialog from `/members/{publicId}`,
 *      including the reason-required gate on the dialog's submit
 *      button (form validation that lives in the React component).
 *   2. The banned user's email is observably non-existent at the
 *      magic-link request endpoint — Mailpit receives no message.
 *      Every server-side blocklist short-circuit is exercised
 *      independently in unit tests, but the wall-clock "officer
 *      bans → user can't sign in" guarantee only holds if the
 *      Worker-deployed config matches.
 *   3. Unban returns the user to `pending` and clears the blocklist
 *      so a subsequent magic-link request DOES deliver. Same end-
 *      to-end asymmetry as #2 — the auto-clear is unit-tested in
 *      isolation, but the round-trip via real D1 + real Mailpit is
 *      what catches a regression on the wired-up flow.
 *
 * Why this is worth the spec slot: ban is the most security-shaped
 * feature on the site (hard ouster, email blocklist, separate
 * permission). A subtle drift — say the magic-link request stops
 * checking the blocklist, or the unban auto-clear regresses — would
 * be operationally invisible until a real ban is misissued or a real
 * unban silently fails to restore access.
 */

/** Look up the publicId for a seeded user (so the test can navigate
 *  to /members/{publicId} without scraping the directory list). */
function readPublicId(email: string): string {
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  const out = execD1(
    `SELECT u.public_id as public_id FROM users u JOIN user_emails ue ON ue.user_id = u.id WHERE ue.email = ${escapedEmail};`,
  );
  const parsed = JSON.parse(out) as Array<{
    results: Array<{ public_id: string }>;
  }>;
  const id = parsed[0]?.results?.[0]?.public_id;
  if (!id) {
    throw new Error(`No publicId for ${email}`);
  }
  return id;
}

/** Look up the current `users.status` for a seeded email. Test
 *  asserts the unban transition lands the user in `pending`, not
 *  `approved` — this is the load-bearing decision the plan locked
 *  in. Without a DB-side check, a future refactor that flipped the
 *  unban target to `approved` would visually still hide the row from
 *  the Banned tab and pass a UI-only assertion. */
function readStatus(email: string): string | null {
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  const out = execD1(
    `SELECT u.status as status FROM users u JOIN user_emails ue ON ue.user_id = u.id WHERE ue.email = ${escapedEmail};`,
  );
  try {
    const parsed = JSON.parse(out) as Array<{
      results: Array<{ status: string }>;
    }>;
    return parsed[0]?.results?.[0]?.status ?? null;
  } catch {
    return null;
  }
}

/** Count rows in `banned_emails` matching an address — covers both
 *  the post-ban "row exists" assertion and the post-unban "row gone"
 *  assertion in one helper. */
function countBlocklist(email: string): number {
  const escapedEmail = `'${email.replace(/'/g, "''")}'`;
  const out = execD1(
    `SELECT COUNT(*) as n FROM banned_emails WHERE email = ${escapedEmail};`,
  );
  try {
    const parsed = JSON.parse(out) as Array<{
      results: Array<{ n: number }>;
    }>;
    return parsed[0]?.results?.[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/** Sign in as a system_admin via the magic-link flow. Mirrors the
 *  helper in `management.spec.ts`; duplicated here rather than
 *  cross-imported because each spec keeps its own helpers (parallel
 *  workers + per-spec fixture isolation). */
async function signInAsOfficer(
  page: Page,
  mailpit: {
    extractFirstLink: (email: string, timeoutMs?: number) => Promise<string>;
  },
  email: string,
): Promise<void> {
  ensureApprovedUser(email, { roles: ["role_system_admin"] });
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("textbox", { name: /email/i }).fill(email);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();
  const link = await mailpit.extractFirstLink(email, 30_000);
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: /continue to ucmc/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/callback"), {
    timeout: 15_000,
  });
}

/** Sign out the current user via the user menu. Used between the
 *  ban-as-admin and verify-no-magic-link-as-anon halves of the
 *  happy-path test. */
async function signOut(page: Page): Promise<void> {
  await page.goto("/");
  await waitForHydration(page);
  // The signOutFn doesn't have a UI button on every page; the
  // simplest deterministic path is to call the route handler that
  // closes the session — but Tanstack Start doesn't expose the fn
  // outside React. A direct cookie clear + reload is equivalent for
  // this test's purpose: the next request lands without a session.
  await page.context().clearCookies();
}

test("ban → magic-link silently dropped → unban → magic-link delivers again", async ({
  page,
  mailpit,
}) => {
  const officerEmail = `e2e-officer-ban-${Date.now()}@example.com`;
  const victimEmail = `e2e-ban-victim-${Date.now()}@example.com`;

  // Seed the victim as a vanilla approved member. Banning will flip
  // their status, mirror their email into the blocklist, and (per
  // the action) immediately purge any active sessions — no live
  // session for the victim in this spec, but the seed still mirrors
  // production state.
  ensureApprovedUser(victimEmail);
  const victimPublicId = readPublicId(victimEmail);

  await signInAsOfficer(page, mailpit, officerEmail);

  // 1. Open the victim's detail page and click Ban.
  await page.goto(`/members/${victimPublicId}`);
  await waitForHydration(page);
  await page.getByRole("button", { name: /^ban$/i }).click();

  // The dialog requires a reason ≥10 chars. Submit with an empty
  // reason first — the action button must stay disabled.
  const dialogTitle = page.getByRole("alertdialog");
  await expect(dialogTitle).toBeVisible();
  const submit = page.getByRole("button", { name: /^ban(ning)?\b/i }).last();
  await expect(submit).toBeDisabled();

  // Now type a reason and submit.
  await page
    .getByLabel(/reason/i)
    .fill("Repeated harassment of other members in trip channels.");
  await expect(submit).toBeEnabled();
  await submit.click();

  // Wait for the mutation to complete — the detail page re-queries
  // and the action button collapses back to a single "Unban" affordance.
  await expect(page.getByRole("button", { name: /^unban$/i })).toBeVisible({
    timeout: 10_000,
  });

  // DB-side: status flipped, blocklist seeded.
  expect(readStatus(victimEmail)).toBe("banned");
  expect(countBlocklist(victimEmail)).toBe(1);

  // 2. Sign out. As an anonymous visitor, request a magic link to the
  //    banned address. Mailpit must observe NO new message — the
  //    request endpoint short-circuits before the Resend call.
  await signOut(page);
  await mailpit.clear();

  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("textbox", { name: /email/i }).fill(victimEmail);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  // Same confirmation copy as the honored path — no info leak.
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();

  // Poll Mailpit for ~2s — long enough for the timing-padded request
  // to settle plus a generous buffer, short enough to keep the test
  // snappy. A successful send would land within hundreds of ms.
  const pollDeadline = Date.now() + 2_000;
  while (Date.now() < pollDeadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  await expect(
    (async () => {
      try {
        await mailpit.waitForMessage(victimEmail, 100);
        return "received";
      } catch {
        return "empty";
      }
    })(),
  ).resolves.toBe("empty");

  // 3. Sign back in as admin and unban via the management UI.
  await signInAsOfficer(page, mailpit, officerEmail);
  await page.goto("/members/management?tab=banned");
  await waitForHydration(page);

  const bannedRow = page.getByRole("checkbox", {
    name: new RegExp(`select ${victimEmail}`, "i"),
  });
  await expect(bannedRow).toBeVisible();
  await bannedRow.check();
  await page.getByRole("button", { name: /^unban \(1\)/i }).click();

  // Row leaves the Banned tab.
  await expect(bannedRow).toHaveCount(0, { timeout: 10_000 });

  // DB-side assertions match the plan's locked-in decisions:
  //   - status reverts to `pending` (re-enters approval queue), NOT
  //     `approved`. A future refactor that lands users in `approved`
  //     would silently bypass the gate on the next sign-in.
  //   - blocklist row is auto-cleared in the same step.
  expect(readStatus(victimEmail)).toBe("pending");
  expect(countBlocklist(victimEmail)).toBe(0);

  // 4. Sign out again and re-request a magic link — this time it
  //    SHOULD deliver, proving the blocklist clear was effective.
  await signOut(page);
  await mailpit.clear();

  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("textbox", { name: /email/i }).fill(victimEmail);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();

  // Mailpit receives the link within the standard window.
  const message = await mailpit.waitForMessage(victimEmail, 30_000);
  expect(message.Subject).toMatch(/sign in/i);
});
