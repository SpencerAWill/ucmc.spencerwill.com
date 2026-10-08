import { expect, test } from "@playwright/test";

import type { BrowserContext, Page } from "@playwright/test";

import {
  ensureApprovedUser,
  queryD1,
  seedPendingUserWithProfile,
  seedSession,
  SESSION_COOKIE_NAME,
} from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * The two passkey-enrollment surfaces outside `/my/security`: the
 * `/register/pending` card and the `/my/profile` nudge.
 *
 * Separate from `passkey.spec.ts` because the subject is different and
 * so is the setup. That spec is the *sign-in* round trip and has to go
 * through a real magic link, which means Mailpit; both tests here are
 * about surfaces reached while already signed in, so they seed the
 * session directly and need no sidecar.
 *
 * **Both are here because both failed first as code that read
 * correctly.** The compact enrollment flow turns on two things a
 * component test cannot see — a real `Set-Cookie` from the session
 * rotation, and the real ordering between a mutation's cache
 * invalidation and its caller's success callback. Each is described on
 * the test that covers it.
 */

/**
 * Same virtual-authenticator setup as `passkey.spec.ts`: a discoverable
 * credential that auto-confirms, so there is no OS UI to dismiss.
 */
async function attachVirtualAuthenticator(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** Credentials on the account owning `email`. */
function credentialCount(email: string): number {
  const rows = queryD1<{ n: number }>(
    `SELECT COUNT(*) AS n FROM passkey_credentials
     WHERE user_id IN (SELECT user_id FROM user_emails WHERE email = ?)`,
    email,
  );
  return rows[0].n;
}

/**
 * **Session rotation is the reason this one exists.**
 * `webauthnRegisterFinishAction` ends with
 * `rotateSession(principal.userId)` — a privilege boundary, so a stolen
 * pre-enrollment session id can't be replayed afterwards. It is written
 * against a `userId` and says nothing about account status, but "says
 * nothing about" is a reading of the code, and `/register/pending` is
 * the first surface to call it from a non-approved principal. A
 * rotation that dropped the session here would sign a member out
 * mid-registration — the worst possible moment, and one no unit test
 * covers, because the cookie write only happens in a real request.
 */
test("a pending member enrolls a passkey and stays signed in through the rotation", async ({
  page,
  context,
}) => {
  const email = `e2e-pending-passkey-${Date.now()}@example.com`;
  seedPendingUserWithProfile(email);
  const seededSid = seedSession(email);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: seededSid, url: BASE_URL },
  ]);
  await attachVirtualAuthenticator(page, context);

  await page.goto("/register/pending");
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: /thanks for registering/i }),
  ).toBeVisible();

  await page.getByRole("button", { name: /add a passkey/i }).click();

  // The compact variant has no credential list to re-render, so this
  // line IS the success signal — for the member and for the test.
  await expect(page.getByText(/passkey added on this device/i)).toBeVisible({
    timeout: 10_000,
  });

  // The credential is really on the account, not just reported.
  expect(credentialCount(email)).toBe(1);

  // Rotation happened: a different opaque session id is in the cookie.
  const rotated = (await context.cookies(BASE_URL)).find(
    (c) => c.name === SESSION_COOKIE_NAME,
  );
  expect(rotated?.value).toBeTruthy();
  expect(rotated?.value).not.toBe(seededSid);

  // And the replacement is a session the server honours. A reload is
  // what proves it: `/register/pending` runs `requireAuth`, so a
  // rotation that left a dangling cookie lands on `/sign-in` instead.
  await page.reload();
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: /thanks for registering/i }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/register/pending");
});

/**
 * **The ordering trap is the reason this one exists, and it is not
 * theoretical — it shipped past a green unit suite.**
 *
 * `PasskeyNudge` renders only for a member holding zero credentials,
 * and enrolling invalidates the very query that answers that. The first
 * implementation kept the card open with a callback from the button's
 * per-`mutate` `onSuccess` — which runs *after* `useAddPasskey`'s own
 * `onSuccess` has awaited the invalidation. On the real page the
 * refetch wins, the card unmounts, and the member's click appears to do
 * nothing at all. A component test driving the same mutation passed:
 * its mocked refetch settles in a microtask and loses the race the real
 * one wins.
 *
 * So this test is deliberately a full lifecycle rather than a render
 * assertion — offered, enrolled, confirmed, and gone on the next load —
 * because the middle step is the one that only fails for real.
 */
test("the profile nudge enrolls in place and retires once a credential exists", async ({
  page,
  context,
}) => {
  const email = `e2e-nudge-passkey-${Date.now()}@example.com`;
  ensureApprovedUser(email);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: seedSession(email), url: BASE_URL },
  ]);
  await attachVirtualAuthenticator(page, context);

  await page.goto("/my/profile");
  await waitForHydration(page);
  await expect(page.getByText(/sign in faster next time/i)).toBeVisible();

  await page.getByRole("button", { name: /add a passkey/i }).click();
  await expect(page.getByText(/passkey added on this device/i)).toBeVisible({
    timeout: 10_000,
  });
  expect(credentialCount(email)).toBe(1);

  // Self-retiring: the member now holds a credential, so the next load
  // has nothing to say to them.
  await page.reload();
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", { name: "Profile", level: 2 }),
  ).toBeVisible();
  await expect(page.getByText(/sign in faster next time/i)).toHaveCount(0);
});
