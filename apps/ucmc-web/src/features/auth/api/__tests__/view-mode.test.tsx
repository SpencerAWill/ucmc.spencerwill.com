/**
 * `ViewModeProvider` — the client half of role emulation.
 *
 * Two things have to happen on every switch, and the second is easy to
 * lose: patch the session cache (so the chrome redraws) *and* invalidate
 * the router (so `beforeLoad` re-runs for the page you're already on).
 * Without the invalidate, switching to a narrower role while sitting on
 * `/settings` leaves the settings page fully rendered — the guards only
 * re-evaluate on navigation — and "Exit preview" can't rescue you off a
 * `notFound()` a preview threw.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_QUERY_KEY } from "#/features/auth/api/query-keys";
import { ViewModeProvider, useViewMode } from "#/features/auth/api/view-mode";

const invalidate = vi.fn(() => Promise.resolve());

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));

function Switcher({ role }: { role: string | null }) {
  const { setEmulatedRole } = useViewMode();
  return (
    <button type="button" onClick={() => setEmulatedRole(role)}>
      switch
    </button>
  );
}

function setup(role: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(SESSION_QUERY_KEY, {
    principal: { userId: "u1" },
    anonymousPermissions: [],
    emulatedRole: null,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ViewModeProvider>
        <Switcher role={role} />
      </ViewModeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("ViewModeProvider", () => {
  beforeEach(() => {
    invalidate.mockClear();
    document.cookie = "ucmc_view_as=; Path=/; Max-Age=0";
  });

  it("patches the session cache so the chrome sees the preview", async () => {
    const queryClient = setup("member");
    await userEvent.click(document.querySelector("button")!);
    expect(
      queryClient.getQueryData<{ emulatedRole: string | null }>(
        SESSION_QUERY_KEY,
      )?.emulatedRole,
    ).toBe("member");
  });

  it("writes the cookie the server reads on the next hard navigation", async () => {
    setup("treasurer");
    await userEvent.click(document.querySelector("button")!);
    expect(document.cookie).toContain("ucmc_view_as=treasurer");
  });

  it("invalidates the router so guards re-run for the current page", async () => {
    setup("member");
    await userEvent.click(document.querySelector("button")!);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("invalidates on exit too, so a preview's notFound can be escaped", async () => {
    const queryClient = setup(null);
    await userEvent.click(document.querySelector("button")!);
    expect(
      queryClient.getQueryData<{ emulatedRole: string | null }>(
        SESSION_QUERY_KEY,
      )?.emulatedRole,
    ).toBeNull();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
