/**
 * Unit tests for the `beforeLoad` guards. Each guard is pure logic
 * over a `QueryClient`-cached session, so seeding the cache lets us
 * exercise every branch without spinning up the router. The thrown
 * objects are introspected with TanStack Router's `isRedirect` /
 * `isNotFound` predicates rather than `instanceof` so the tests stay
 * resilient to internal class refactors.
 */
import { QueryClient } from "@tanstack/react-query";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { SESSION_QUERY_KEY } from "#/features/auth/api/query-keys";
import {
  FEEDBACK_MANAGE_PERMISSIONS,
  canReachMyFeedback,
  effectivePermissionsFor,
  feedbackAreaDecision,
  requireAnyPermission,
  requireAnyPermissionOrNotFound,
  requireApproved,
  requireAuth,
  requireCurrentWaiver,
  requirePermission,
  requirePermissionOrNotFound,
  requireViewPermission,
} from "#/features/auth/guards";
import type { GuardArgs } from "#/features/auth/guards";
import type { Principal } from "#/server/auth/principal.server";

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: "u_test",
    primaryEmail: "test@example.com",
    emails: ["test@example.com"],
    preferredName: "Test",
    status: "approved",
    hasProfile: true,
    avatarKey: null,
    roles: ["member"],
    isSystemAdmin: false,
    permissions: [],
    rolePermissionMap: {},
    roleDisplayNames: {},
    ...overrides,
  };
}

function clientWithPrincipal(
  principal: Principal | null,
  emulatedRole: string | null = null,
  anonymousPermissions: string[] = [],
): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Seed under the same key + shape the real session query uses so
  // `getQueryData` returns it and `ensureQueryData` is never reached.
  // `emulatedRole` is part of that shape now — the server resolves it
  // from the `ucmc_view_as` cookie, so it's already validated by the
  // time a guard reads it.
  client.setQueryData(SESSION_QUERY_KEY, {
    principal,
    anonymousPermissions,
    emulatedRole,
  });
  return client;
}

/** The `beforeLoad` arguments a guard reads, for a visitor at `href`. */
function argsFor(client: QueryClient, href = "/somewhere"): GuardArgs {
  const url = new URL(href, "https://ucmc.example");
  return {
    context: { queryClient: client },
    location: { pathname: url.pathname, searchStr: url.search },
  };
}

/** Run a guard, catching its thrown redirect/notFound so tests can
 *  introspect the throw shape instead of crashing. */
async function capture<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; thrown: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (thrown) {
    return { ok: false, thrown };
  }
}

/**
 * The value a captured guard threw, or a sentinel when it didn't throw.
 *
 * Exists so the throw-shape assertions below can be unconditional. The
 * obvious spelling — `expect(result.ok).toBe(false)` then `if
 * (!result.ok) { expect(isRedirect(result.thrown)) }` — needs the `if`
 * only to narrow the union for TypeScript, but an assertion inside a
 * branch is one that does nothing when the branch isn't taken, and
 * `vitest/no-conditional-expect` cannot tell the two apart. Returning a
 * sentinel keeps the narrowing here and lets `isRedirect(…)` /
 * `isNotFound(…)` simply be false when the guard wrongly allowed the
 * call through.
 */
function thrownBy(
  result: { ok: true; value: unknown } | { ok: false; thrown: unknown },
): unknown {
  return result.ok ? "guard did not throw" : result.thrown;
}

describe("requireApproved", () => {
  it("returns the principal when status=approved + hasProfile", async () => {
    const client = clientWithPrincipal(makePrincipal());
    const principal = await requireApproved(argsFor(client));
    expect(principal.userId).toBe("u_test");
  });

  it("redirects to /sign-in when no principal is cached", async () => {
    const client = clientWithPrincipal(null);
    const result = await capture(() =>
      requireApproved(argsFor(client, "/gear/abc?tab=loans#history")),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    // The redirect carries the original location — path and search,
    // never the hash — so the post-sign-in bounce sends the user back
    // where they tried to go.
    const opts = (
      result.thrown as Response & {
        options: { to: string; search?: { redirect?: string } };
      }
    ).options;
    expect(opts.to).toBe("/sign-in");
    expect(opts.search?.redirect).toBe("/gear/abc?tab=loans");
  });

  it("redirects to /register/profile when the principal has no profile", async () => {
    const client = clientWithPrincipal(makePrincipal({ hasProfile: false }));
    const result = await capture(() => requireApproved(argsFor(client)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    expect(
      (result.thrown as Response & { options: { to: string } }).options.to,
    ).toBe("/register/profile");
  });

  it("redirects to /deactivated when the principal is deactivated", async () => {
    const client = clientWithPrincipal(
      makePrincipal({ status: "deactivated" }),
    );
    const result = await capture(() => requireApproved(argsFor(client)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    expect(
      (result.thrown as Response & { options: { to: string } }).options.to,
    ).toBe("/deactivated");
  });

  it("redirects to /register/pending for any other non-approved status", async () => {
    const client = clientWithPrincipal(makePrincipal({ status: "pending" }));
    const result = await capture(() => requireApproved(argsFor(client)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    expect(
      (result.thrown as Response & { options: { to: string } }).options.to,
    ).toBe("/register/pending");
  });
});

describe("every account-status guard carries the return path", () => {
  // The point of taking the beforeLoad args whole: no guard can bounce a
  // signed-out visitor to a bare /sign-in. Table-driven so a new guard
  // is one row.
  const guards: [string, (args: GuardArgs) => Promise<unknown>][] = [
    ["requireAuth", requireAuth],
    ["requireApproved", requireApproved],
    ["requireCurrentWaiver", requireCurrentWaiver],
    ["requirePermission", (a) => requirePermission(a, "gear:read")],
    [
      "requirePermissionOrNotFound",
      (a) => requirePermissionOrNotFound(a, "gear:read"),
    ],
    ["requireAnyPermission", (a) => requireAnyPermission(a, ["gear:read"])],
    [
      "requireAnyPermissionOrNotFound",
      (a) => requireAnyPermissionOrNotFound(a, ["gear:read"]),
    ],
  ];

  it.each(guards)("%s", async (_name, guard) => {
    const client = clientWithPrincipal(null);
    const thrown = thrownBy(
      await capture(() => guard(argsFor(client, "/members?q=ada"))),
    );
    expect(isRedirect(thrown)).toBe(true);
    expect(
      (thrown as { options: { to: string; search?: { redirect?: string } } })
        .options,
    ).toMatchObject({ to: "/sign-in", search: { redirect: "/members?q=ada" } });
  });
});

describe("requireAuth on a sign-in-flow page", () => {
  // /deactivated and /register/pending call requireAuth themselves; a
  // return path to them would land the next sign-in on a stale status
  // page, or nest ?redirect= inside itself.
  it.each(["/deactivated", "/register/pending?redirect=%2Fmembers"])(
    "%s carries no return path",
    async (path) => {
      const thrown = thrownBy(
        await capture(() =>
          requireAuth(argsFor(clientWithPrincipal(null), path)),
        ),
      );
      expect(isRedirect(thrown)).toBe(true);
      expect(
        (thrown as { options: { search?: { redirect?: string } } }).options
          .search,
      ).toEqual({});
    },
  );
});

describe("requireApproved carries the return path into the funnel", () => {
  it.each([
    ["/register/profile", makePrincipal({ hasProfile: false })],
    ["/register/pending", makePrincipal({ status: "pending" })],
  ])("to %s", async (to, principal) => {
    const thrown = thrownBy(
      await capture(() =>
        requireApproved(
          argsFor(clientWithPrincipal(principal), "/members?q=ada"),
        ),
      ),
    );
    expect(isRedirect(thrown)).toBe(true);
    expect(
      (thrown as { options: { to: string; search?: { redirect?: string } } })
        .options,
    ).toMatchObject({ to, search: { redirect: "/members?q=ada" } });
  });
});

describe("requirePermission", () => {
  it("returns the principal when they hold the permission", async () => {
    const client = clientWithPrincipal(
      makePrincipal({ permissions: ["members:manage"] }),
    );
    const principal = await requirePermission(
      argsFor(client),
      "members:manage",
    );
    expect(principal.permissions).toContain("members:manage");
  });

  it("redirects to / when the approved principal lacks the permission", async () => {
    const client = clientWithPrincipal(makePrincipal({ permissions: [] }));
    const result = await capture(() =>
      requirePermission(argsFor(client), "members:manage"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    expect(
      (result.thrown as Response & { options: { to: string } }).options.to,
    ).toBe("/");
  });

  it("inherits requireApproved's redirect when the user isn't approved yet", async () => {
    const client = clientWithPrincipal(makePrincipal({ status: "pending" }));
    const result = await capture(() =>
      requirePermission(argsFor(client), "members:manage"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    expect(
      (result.thrown as Response & { options: { to: string } }).options.to,
    ).toBe("/register/pending");
  });
});

describe("requirePermissionOrNotFound", () => {
  it("returns the principal when they hold the permission", async () => {
    const client = clientWithPrincipal(
      makePrincipal({ permissions: ["members:manage"] }),
    );
    const principal = await requirePermissionOrNotFound(
      argsFor(client),
      "members:manage",
    );
    expect(principal.permissions).toContain("members:manage");
  });

  it("throws notFound (not a redirect) when the approved principal lacks the permission", async () => {
    const client = clientWithPrincipal(makePrincipal({ permissions: [] }));
    const result = await capture(() =>
      requirePermissionOrNotFound(argsFor(client), "members:manage"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The whole point of this variant: we want notFound, NOT a /
    // redirect, so direct navigation surfaces the app's notFound
    // boundary instead of silently bouncing.
    expect(isNotFound(result.thrown)).toBe(true);
    expect(isRedirect(result.thrown)).toBe(false);
  });

  it("still funnels unapproved users into the registration flow", async () => {
    // The `OrNotFound` flavor only changes the *missing-permission*
    // branch; unapproved users should still get the friendly redirect
    // from `requireApproved` (not a 404).
    const client = clientWithPrincipal(makePrincipal({ status: "pending" }));
    const result = await capture(() =>
      requirePermissionOrNotFound(argsFor(client), "members:manage"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    expect(isNotFound(result.thrown)).toBe(false);
    expect(
      (result.thrown as Response & { options: { to: string } }).options.to,
    ).toBe("/register/pending");
  });
});

describe("role preview ('View as')", () => {
  const sysAdmin = makePrincipal({
    roles: ["system_admin"],
    isSystemAdmin: true,
    permissions: ["settings:manage", "members:manage"],
    rolePermissionMap: {
      system_admin: ["settings:manage", "members:manage"],
      member: ["gear:read"],
    },
  });

  it("redirects a previewed role away from a page it can't reach", async () => {
    // The reported bug: emulation filtered the sidebar but not the
    // guard, so typing /settings while previewing `member` walked
    // straight in. `requirePermission` is what gates that route.
    const client = clientWithPrincipal(sysAdmin, "member");
    const result = await capture(() =>
      requirePermission(argsFor(client), "settings:manage"),
    );
    expect(result.ok).toBe(false);
    expect(isRedirect(thrownBy(result))).toBe(true);
  });

  it("404s a previewed role on a notFound-style route", async () => {
    const client = clientWithPrincipal(sysAdmin, "member");
    const result = await capture(() =>
      requirePermissionOrNotFound(argsFor(client), "members:manage"),
    );
    expect(result.ok).toBe(false);
    expect(isNotFound(thrownBy(result))).toBe(true);
  });

  it("still allows what the previewed role does hold", async () => {
    const client = clientWithPrincipal(sysAdmin, "member");
    const principal = await requirePermission(argsFor(client), "gear:read");
    // The guard returns the REAL principal — a preview narrows what you
    // can reach, it doesn't rewrite who you are. Server actions read
    // this same real principal and are unaffected.
    expect(principal.permissions).toContain("settings:manage");
  });

  it("does not gate account status on the preview", async () => {
    // `requireApproved` keys on status, which no role preview changes.
    // Without this, previewing a low-permission role could eject an
    // admin from their own /my/* pages.
    const client = clientWithPrincipal(sysAdmin, "member");
    const principal = await requireApproved(argsFor(client));
    expect(principal.userId).toBe("u_test");
  });

  it("ignores a preview the principal's map doesn't describe", async () => {
    // Forged cookie: a plain member asking to preview system_admin.
    // Resolution happens server-side, but the guard must also be inert
    // if an unvalidated value ever reaches the cache.
    const member = makePrincipal({
      permissions: ["gear:read"],
      rolePermissionMap: { member: ["gear:read"] },
    });
    const client = clientWithPrincipal(member, "system_admin");
    const result = await capture(() =>
      requirePermission(argsFor(client), "settings:manage"),
    );
    expect(result.ok).toBe(false);
    expect(isRedirect(thrownBy(result))).toBe(true);
  });
});

/**
 * `effectivePermissionsFor` is exported because the three `/feedback`
 * routes can't use `requirePermission` — they pick between two surfaces
 * rather than gating on one permission — and they were reading
 * `principal.permissions` directly, which is the one thing a preview
 * can't reach. These pin that they now see the preview, and that the
 * surface pairs are named rather than spelled out per call site.
 */
describe("effectivePermissionsFor", () => {
  const admin = makePrincipal({
    isSystemAdmin: true,
    permissions: ["club_feedback:manage", "site_feedback:manage"],
    rolePermissionMap: {
      system_admin: ["club_feedback:manage", "site_feedback:manage"],
      member: ["club_feedback:submit"],
    },
  });

  it("returns the real permission set with no preview active", async () => {
    const client = clientWithPrincipal(admin);
    await expect(effectivePermissionsFor(client, admin)).resolves.toEqual(
      admin.permissions,
    );
  });

  it("narrows to the previewed role's grants", async () => {
    const client = clientWithPrincipal(admin, "member");
    const granted = await effectivePermissionsFor(client, admin);
    expect(granted).toEqual(["club_feedback:submit"]);
    // The consequence the /feedback area depends on: previewing `member`
    // drops both manage permissions, so the area sends the admin to
    // /my/feedback, matching the sidebar entry disappearing.
    expect(FEEDBACK_MANAGE_PERMISSIONS.some((x) => granted.includes(x))).toBe(
      false,
    );
  });
});

/**
 * #300: an account waiting on approval holds no roles until
 * `role_member` is added on approval, so it used to resolve to an empty
 * permission set and 404 on every public page a signed-out visitor could
 * open. Signing in must never hide a public page.
 */
describe("requireViewPermission", () => {
  const ANONYMOUS = ["public_calendar:view"];
  const pending = makePrincipal({
    status: "pending",
    roles: [],
    permissions: [],
    rolePermissionMap: {},
  });

  it("lets an anonymous visitor through on an anonymous grant", async () => {
    const client = clientWithPrincipal(null, null, ANONYMOUS);
    await expect(
      requireViewPermission(client, "public_calendar:view"),
    ).resolves.toBeNull();
  });

  it("lets a principal with no roles through on an anonymous grant", async () => {
    const client = clientWithPrincipal(pending, null, ANONYMOUS);
    await expect(
      requireViewPermission(client, "public_calendar:view"),
    ).resolves.toBe(pending);
  });

  it("still 404s a principal on a permission neither they nor anonymous hold", async () => {
    const client = clientWithPrincipal(pending, null, ANONYMOUS);
    const result = await capture(() =>
      requireViewPermission(client, "history:view"),
    );
    expect(isNotFound(thrownBy(result))).toBe(true);
  });

  it("keeps the anonymous floor under a role preview", async () => {
    const admin = makePrincipal({
      isSystemAdmin: true,
      permissions: ["public_calendar:view", "waivers:verify"],
      rolePermissionMap: { treasurer: ["waivers:verify"] },
    });
    const client = clientWithPrincipal(admin, "treasurer", ANONYMOUS);
    await expect(
      requireViewPermission(client, "public_calendar:view"),
    ).resolves.toBe(admin);
  });
});

describe("effectivePermissionsFor and the anonymous floor", () => {
  it("includes the anonymous grants for a principal with no roles", async () => {
    const pending = makePrincipal({ status: "pending", roles: [] });
    const client = clientWithPrincipal(pending, null, ["public_calendar:view"]);
    await expect(effectivePermissionsFor(client, pending)).resolves.toEqual([
      "public_calendar:view",
    ]);
  });
});

describe("canReachMyFeedback", () => {
  it("is true for site_feedback:submit alone", () => {
    expect(canReachMyFeedback(["site_feedback:submit"])).toBe(true);
  });

  it("is true for club_feedback:submit alone", () => {
    expect(canReachMyFeedback(["club_feedback:submit"])).toBe(true);
  });

  it("is false for neither, even holding both manage permissions", () => {
    expect(canReachMyFeedback([])).toBe(false);
    expect(
      canReachMyFeedback(["site_feedback:manage", "club_feedback:manage"]),
    ).toBe(false);
  });
});

describe("feedbackAreaDecision", () => {
  it("allow for site manage alone", () => {
    expect(feedbackAreaDecision(["site_feedback:manage"], true)).toBe("allow");
  });

  it("allow for club manage alone", () => {
    expect(feedbackAreaDecision(["club_feedback:manage"], false)).toBe("allow");
  });

  it("redirect_my_feedback for submit-only when enabled", () => {
    expect(
      feedbackAreaDecision(
        ["site_feedback:submit", "club_feedback:submit"],
        true,
      ),
    ).toBe("redirect_my_feedback");
  });

  it("not_found for submit-only when pages.my_feedback is off", () => {
    expect(feedbackAreaDecision(["site_feedback:submit"], false)).toBe(
      "not_found",
    );
  });

  it("redirect_my_feedback for no permissions at all when enabled", () => {
    expect(feedbackAreaDecision([], true)).toBe("redirect_my_feedback");
  });
});
