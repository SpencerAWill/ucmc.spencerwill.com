import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PasskeyNudge } from "#/features/auth/components/passkey-nudge";

const listPasskeysFn = vi.hoisted(() => vi.fn());
const webauthnRegisterBeginFn = vi.hoisted(() => vi.fn());
const webauthnRegisterFinishFn = vi.hoisted(() => vi.fn());
const startRegistration = vi.hoisted(() => vi.fn());

// One mutable snapshot behind both `queryFn` and `placeholderData` so a
// test flipping the flag can't leave the two disagreeing — the component
// reads the placeholder on its very first render.
const flags = vi.hoisted(() => ({
  current: { pages: { my_security: true } },
}));

vi.mock("#/features/auth/server/webauthn-fns", () => ({
  listPasskeysFn: (...args: unknown[]) => listPasskeysFn(...args),
  webauthnRegisterBeginFn: (...args: unknown[]) =>
    webauthnRegisterBeginFn(...args),
  webauthnRegisterFinishFn: (...args: unknown[]) =>
    webauthnRegisterFinishFn(...args),
}));

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: (...args: unknown[]) => startRegistration(...args),
}));

// Pulled in through `#/features/auth/api/queries`, which the nudge reads
// for the passkey list; nothing calls these at runtime.
vi.mock("#/features/auth/server/server-fns", () => ({
  getSessionFn: vi.fn(),
  getProfileFn: vi.fn(),
  signOutFn: vi.fn(),
}));
vi.mock("#/features/auth/server/email-fns", () => ({
  listMyEmailsFn: vi.fn(),
}));
vi.mock("#/features/auth/server/notification-prefs-fns", () => ({
  listMyNotificationPreferencesFn: vi.fn(),
}));

vi.mock("#/features/settings/api/queries", () => ({
  publicFlagsQueryOptions: () => ({
    queryKey: ["public-flags"],
    queryFn: () => flags.current,
    placeholderData: flags.current,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const DISMISSED_KEY = "ucmc:passkey-nudge:dismissed";
const PASSKEY_LIST_QUERY_KEY = ["account", "passkeys"] as const;

function renderNudge() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <PasskeyNudge />
      </QueryClientProvider>,
    ),
  };
}

const heading = () => screen.queryByText(/sign in faster next time/i);

describe("PasskeyNudge", () => {
  beforeEach(() => {
    listPasskeysFn.mockReset();
    webauthnRegisterBeginFn.mockReset();
    webauthnRegisterFinishFn.mockReset();
    startRegistration.mockReset();
    flags.current = { pages: { my_security: true } };
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("offers enrollment to a member holding no passkeys", async () => {
    listPasskeysFn.mockResolvedValue({ ok: true, passkeys: [] });

    renderNudge();

    expect(await screen.findByText(/sign in faster next time/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /add a passkey/i }),
    ).toBeInTheDocument();
  });

  it("stays away while the passkey list is still loading", () => {
    // Never resolves: the nudge must not flash in before it knows the
    // answer, since the common case for an established member is that
    // it has nothing to say.
    listPasskeysFn.mockReturnValue(new Promise(() => {}));

    renderNudge();

    expect(heading()).not.toBeInTheDocument();
  });

  it("stays away once the member has a passkey", async () => {
    listPasskeysFn.mockResolvedValue({
      ok: true,
      passkeys: [{ credentialId: "cred-1" }],
    });

    renderNudge();

    await waitFor(() => {
      expect(listPasskeysFn).toHaveBeenCalled();
    });
    expect(heading()).not.toBeInTheDocument();
  });

  it("stays away when pages.my_security is switched off", async () => {
    flags.current = { pages: { my_security: false } };
    listPasskeysFn.mockResolvedValue({ ok: true, passkeys: [] });

    renderNudge();

    // The whole point of the gate: the list query must not even run,
    // because the flag is the site-wide switch for passkey UI.
    await waitFor(() => {
      expect(heading()).not.toBeInTheDocument();
    });
    expect(listPasskeysFn).not.toHaveBeenCalled();
  });

  it("hides on dismiss and stays hidden on the next mount", async () => {
    const user = userEvent.setup();
    listPasskeysFn.mockResolvedValue({ ok: true, passkeys: [] });

    const { unmount } = renderNudge();
    await screen.findByText(/sign in faster next time/i);

    await user.click(
      screen.getByRole("button", { name: /dismiss passkey suggestion/i }),
    );
    expect(heading()).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe("true");

    unmount();
    renderNudge();
    await waitFor(() => {
      expect(listPasskeysFn).toHaveBeenCalled();
    });
    expect(heading()).not.toBeInTheDocument();
  });

  /**
   * The snapshot rule, tested without the ceremony so the assertion
   * doesn't depend on callback ordering — which is exactly what the
   * first attempt at this component got wrong. It latched the card open
   * from the button's per-`mutate` `onSuccess`, and that callback runs
   * *after* `useAddPasskey`'s own `onSuccess` has awaited the
   * invalidation: by then the refetch has landed, the live read says
   * "has a passkey", and the card is already gone. A unit test driving
   * the mutation passed anyway — the mocked refetch settles in a
   * microtask and lost the race the real one wins — so the regression
   * only showed up end to end. Pinning the invalidation directly is
   * what makes this test able to see it.
   */
  it("keeps an offer on screen when the list refetches with a credential", async () => {
    listPasskeysFn
      .mockResolvedValueOnce({ ok: true, passkeys: [] })
      .mockResolvedValue({ ok: true, passkeys: [{ credentialId: "cred-1" }] });

    const { queryClient } = renderNudge();
    await screen.findByText(/sign in faster next time/i);

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: PASSKEY_LIST_QUERY_KEY,
      });
    });

    await waitFor(() => {
      expect(listPasskeysFn).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText(/sign in faster next time/i)).toBeVisible();
  });

  it("confirms in place after a successful enrollment", async () => {
    const user = userEvent.setup();
    listPasskeysFn
      .mockResolvedValueOnce({ ok: true, passkeys: [] })
      .mockResolvedValue({ ok: true, passkeys: [{ credentialId: "cred-1" }] });
    webauthnRegisterBeginFn.mockResolvedValue({
      ok: true,
      options: { challenge: "abc" },
    });
    startRegistration.mockResolvedValue({ id: "cred-1" });
    webauthnRegisterFinishFn.mockResolvedValue({ ok: true });

    renderNudge();
    await screen.findByText(/sign in faster next time/i);
    await user.click(screen.getByRole("button", { name: /add a passkey/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /passkey added on this device/i,
    );
    await waitFor(() => {
      expect(listPasskeysFn).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
