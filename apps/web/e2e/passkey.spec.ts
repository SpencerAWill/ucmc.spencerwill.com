import { ensureApprovedUser } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

const PASSKEY_USER_EMAIL = "e2e-passkey@example.com";

/**
 * Full register-and-sign-back-in flow:
 *   1. Pre-create the user as approved + with a profile so the
 *      magic-link callback lands them on "/" (the registration funnel
 *      and admin-approval flow are exercised by other paths).
 *   2. Sign in via magic link to get a session.
 *   3. Register a passkey at /account/security with a Playwright
 *      WebAuthn virtual authenticator.
 *   4. Sign out via the user-menu dropdown.
 *   5. Sign back in: navigate to /sign-in. The MagicLinkForm's
 *      Conditional-UI autofill hook fires on mount, the virtual
 *      authenticator auto-confirms the credential created in step 3,
 *      and the user is signed back in without any explicit click —
 *      mirroring the primary production passkey flow. The explicit
 *      "Sign in with a passkey" button is exercised by 3.1.5's
 *      component tests; here we want the more common Conditional UI
 *      round-trip.
 *
 * The virtual authenticator persists for the duration of the test
 * context, so the credential created during registration is the same
 * one queried during sign-in.
 */
test("register a passkey and sign back in with it", async ({
  page,
  context,
  mailpit,
}) => {
  ensureApprovedUser(PASSKEY_USER_EMAIL);

  // Set up a virtual authenticator before any navigation. transport=internal
  // + hasResidentKey=true gives us a discoverable credential, which is what
  // the sign-in form's empty allowCredentials list expects.
  // automaticPresenceSimulation + isUserVerified mean the authenticator
  // auto-confirms ceremonies — no OS UI to dismiss.
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

  // ── Step 1: sign in via magic link ────────────────────────────────────
  await page.goto("/sign-in");
  await waitForHydration(page);

  await page.getByLabel(/email/i).fill(PASSKEY_USER_EMAIL);
  const sendButton = page.getByRole("button", { name: /send sign-in link/i });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();

  const link = await mailpit.extractFirstLink(PASSKEY_USER_EMAIL);
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await waitForHydration(page);

  await page.getByRole("button", { name: /continue to ucmc/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/auth/callback"), {
    timeout: 15_000,
  });

  // ── Step 2: register a passkey ────────────────────────────────────────
  await page.goto("/account/security");
  await waitForHydration(page);

  await page.getByLabel(/nickname/i).fill("e2e device");
  await page.getByRole("button", { name: /add this device/i }).click();

  // The credential list re-renders after the mutation invalidates its
  // query. Asserting on the nickname text proves both the registration
  // round-trip AND that our nickname made it to the server.
  await expect(page.getByText("e2e device")).toBeVisible({ timeout: 10_000 });

  // ── Step 3: sign out ──────────────────────────────────────────────────
  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 10_000 });

  // Confirm the session was actually torn down — the user menu reverts to
  // the anonymous "Sign in" link.
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();

  // ── Step 4: sign back in via Conditional UI ───────────────────────────
  // MagicLinkForm's autofill hook fires `startAuthentication` with
  // `useBrowserAutofill: true` on mount. The virtual authenticator
  // (configured with automaticPresenceSimulation + isUserVerified)
  // auto-confirms the discoverable credential we just registered, and
  // the form's onSuccess navigates the user to "/".
  await page.goto("/sign-in");

  // We don't `waitForHydration` here because the autofill ceremony fires
  // post-hydration — racing it for an interaction would be flaky.
  // Instead, just wait for the navigation away from /sign-in: success
  // means Conditional UI completed the full begin → finish round-trip.
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });

  // Confirm we're authenticated: account menu is rendered, the
  // anonymous Sign in link is gone.
  await expect(page.getByRole("button", { name: /account menu/i })).toBeVisible(
    { timeout: 5_000 },
  );
});
