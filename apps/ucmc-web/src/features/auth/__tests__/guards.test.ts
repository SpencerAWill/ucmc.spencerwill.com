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
  requireApproved,
  requirePermission,
  requirePermissionOrNotFound,
} from "#/features/auth/guards";
import type { Principal } from "#/server/auth/principal.server";

function makePrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: "u_test",
    primaryEmail: "test@example.com",
    emails: ["test@example.com"],
    status: "approved",
    hasProfile: true,
    avatarKey: null,
    roles: ["member"],
    isSystemAdmin: false,
    permissions: [],
    rolePermissionMap: {},
    ...overrides,
  };
}

function clientWithPrincipal(principal: Principal | null): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Seed under the same key + shape the real session query uses so
  // `getQueryData` returns it and `ensureQueryData` is never reached.
  client.setQueryData(SESSION_QUERY_KEY, {
    principal,
    anonymousPermissions: [],
  });
  return client;
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

describe("requireApproved", () => {
  it("returns the principal when status=approved + hasProfile", async () => {
    const client = clientWithPrincipal(makePrincipal());
    const principal = await requireApproved(client);
    expect(principal.userId).toBe("u_test");
  });

  it("redirects to /sign-in when no principal is cached", async () => {
    const client = clientWithPrincipal(null);
    const result = await capture(() => requireApproved(client, "/somewhere"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    // The redirect carries the original location so the post-sign-in
    // bounce sends the user back where they tried to go.
    const opts = (
      result.thrown as Response & {
        options: { to: string; search?: { redirect?: string } };
      }
    ).options;
    expect(opts.to).toBe("/sign-in");
    expect(opts.search?.redirect).toBe("/somewhere");
  });

  it("redirects to /register/profile when the principal has no profile", async () => {
    const client = clientWithPrincipal(makePrincipal({ hasProfile: false }));
    const result = await capture(() => requireApproved(client));
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
    const result = await capture(() => requireApproved(client));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    expect(
      (result.thrown as Response & { options: { to: string } }).options.to,
    ).toBe("/deactivated");
  });

  it("redirects to /register/pending for any other non-approved status", async () => {
    const client = clientWithPrincipal(makePrincipal({ status: "pending" }));
    const result = await capture(() => requireApproved(client));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isRedirect(result.thrown)).toBe(true);
    expect(
      (result.thrown as Response & { options: { to: string } }).options.to,
    ).toBe("/register/pending");
  });
});

describe("requirePermission", () => {
  it("returns the principal when they hold the permission", async () => {
    const client = clientWithPrincipal(
      makePrincipal({ permissions: ["members:manage"] }),
    );
    const principal = await requirePermission(client, "members:manage");
    expect(principal.permissions).toContain("members:manage");
  });

  it("redirects to / when the approved principal lacks the permission", async () => {
    const client = clientWithPrincipal(makePrincipal({ permissions: [] }));
    const result = await capture(() =>
      requirePermission(client, "members:manage"),
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
      requirePermission(client, "members:manage"),
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
      client,
      "members:manage",
    );
    expect(principal.permissions).toContain("members:manage");
  });

  it("throws notFound (not a redirect) when the approved principal lacks the permission", async () => {
    const client = clientWithPrincipal(makePrincipal({ permissions: [] }));
    const result = await capture(() =>
      requirePermissionOrNotFound(client, "members:manage"),
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
      requirePermissionOrNotFound(client, "members:manage"),
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
