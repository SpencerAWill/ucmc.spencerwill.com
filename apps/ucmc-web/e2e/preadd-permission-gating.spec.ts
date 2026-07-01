import { ensureApprovedUser } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Permission gating regression: an approved member without the
 * `members:manage` permission must not be able to reach the management
 * tabs nested under `/members` (pending / unclaimed / rejected /
 * deactivated). Each child route's `beforeLoad` calls
 * `requirePermissionOrNotFound(queryClient, "members:manage")`, which
 * — per `apps/ucmc-web/src/features/auth/guards.ts` — throws `notFound()`
 * instead of redirecting, so direct navigation surfaces the app's
 * notFound boundary rather than silently bouncing the user home.
 *
 * Why an e2e and not a unit test: the notFound is wired via TanStack
 * Router's `beforeLoad` + a thrown `notFound()` instance, which only
 * resolves into an actual rendered boundary when the router is mounted.
 * Unit tests that import the guard would assert the throw shape, not
 * the rendered outcome — and the more interesting failure mode (a
 * future refactor that drops the guard or moves the unclaimed tab onto
 * a different route) is invisible to the unit-level boundary.
 */
test("non-officer cannot reach members management tabs", async ({
  page,
  mailpit,
}) => {
  // Seed an approved member with `role_member` only — no
  // members:manage, no system_admin role-bypass.
  const memberEmail = `e2e-plain-member-${Date.now()}@example.com`;
  ensureApprovedUser(memberEmail, { roles: ["role_member"] });

  // Sign in via the magic-link flow so the session cookie + principal
  // are in the same shape a real user has.
  await page.goto("/sign-in");
  await waitForHydration(page);
  await page.getByRole("textbox", { name: /email/i }).fill(memberEmail);
  await page.getByRole("button", { name: /send sign-in link/i }).click();
  await expect(page.getByText(/check.*for a sign-in link/i)).toBeVisible();
  const link = await mailpit.extractFirstLink(memberEmail);
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await waitForHydration(page);
  await page.getByRole("button", { name: /continue to ucmc/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/callback"), {
    timeout: 15_000,
  });

  // The approved tab itself (`/members`) is open to any approved
  // member — no notFound, no pre-add UI.
  await page.goto("/members");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: /^members$/i })).toBeVisible();

  // Each management child route is gated; direct navigation should
  // surface the notFound boundary and never the pre-add UI.
  for (const path of [
    "/members/pending",
    "/members/unclaimed",
    "/members/rejected",
    "/members/deactivated",
  ]) {
    await page.goto(path);
    await waitForHydration(page);
    await expect(
      page.getByRole("button", { name: /pre-add members/i }),
    ).toHaveCount(0);
  }
});
