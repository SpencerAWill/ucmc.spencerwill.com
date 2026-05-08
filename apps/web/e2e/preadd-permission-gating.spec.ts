import { ensureApprovedUser } from "./fixtures/db";
import { waitForHydration } from "./fixtures/hydration";
import { expect, test } from "./fixtures/mailpit";

/**
 * Permission gating regression: an approved member without the
 * `registrations:approve` permission must not be able to reach
 * `/members/registrations` (which surfaces the pending-registrations
 * queue + the new "Unclaimed" pre-add tab). The route guard is
 * `requirePermission(queryClient, "registrations:approve")`, which
 * — per `requirePermission` in `apps/web/src/features/auth/guards.ts` —
 * redirects approved-but-unauthorized users to `/`.
 *
 * Why an e2e and not a unit test: the redirect is wired via TanStack
 * Router's `beforeLoad` + a thrown `redirect()` instance, which only
 * resolves into an actual navigation when the router is mounted. Unit
 * tests that import the guard would assert the throw shape, not the
 * landing URL — and the more interesting failure mode (a future
 * refactor that drops the guard or moves the unclaimed tab onto a
 * different route) is invisible to the unit-level boundary.
 */
test("non-officer cannot reach /members/registrations", async ({
  page,
  mailpit,
}) => {
  // Seed an approved member with `role_member` only — no
  // registrations:approve, no system_admin role-bypass.
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

  // Try to reach the registrations page directly. The route guard
  // should kick us to `/`. Land somewhere that's *not*
  // `/members/registrations` — the home page is the documented
  // destination, but waiting for "anywhere else" makes the assertion
  // robust to future redirect-target tweaks.
  await page.goto("/members/registrations");
  await page.waitForURL(
    (u) => !u.pathname.startsWith("/members/registrations"),
    { timeout: 10_000 },
  );

  // And the page we actually land on must not contain the unclaimed-
  // pre-add UI affordances (defense in depth — if a future regression
  // skips the redirect but renders an empty stub of the page, the URL
  // assertion alone would miss it).
  await expect(
    page.getByRole("button", { name: /pre-add members/i }),
  ).toHaveCount(0);
});
