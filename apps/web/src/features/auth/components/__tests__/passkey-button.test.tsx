import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddPasskeyButton } from "#/features/auth/components/passkey-button";

const webauthnRegisterBeginFn = vi.fn();
const webauthnRegisterFinishFn = vi.fn();
const startRegistration = vi.fn();

vi.mock("#/features/auth/server/webauthn-fns", () => ({
  webauthnRegisterBeginFn: (...args: unknown[]) =>
    webauthnRegisterBeginFn(...args),
  webauthnRegisterFinishFn: (...args: unknown[]) =>
    webauthnRegisterFinishFn(...args),
}));

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: (...args: unknown[]) => startRegistration(...args),
}));

// AddPasskeyButton imports SESSION_QUERY_KEY from use-auth, which transitively
// pulls in #/server/auth/server-fns. We never call those fns from this test —
// the stub keeps the module tree happy.
vi.mock("#/features/auth/server/server-fns", () => ({
  getSessionFn: vi.fn(),
  signOutFn: vi.fn(),
}));

const LIST_KEY = ["passkeys", "list"] as const;

function renderButton() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AddPasskeyButton listQueryKey={LIST_KEY} />
      </QueryClientProvider>,
    ),
  };
}

describe("AddPasskeyButton", () => {
  beforeEach(() => {
    webauthnRegisterBeginFn.mockReset();
    webauthnRegisterFinishFn.mockReset();
    startRegistration.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the nickname input and the trigger button", () => {
    renderButton();
    expect(screen.getByLabelText(/nickname/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add this device/i }),
    ).toBeInTheDocument();
  });

  it("runs the full register ceremony and invalidates the list on success", async () => {
    const user = userEvent.setup();
    webauthnRegisterBeginFn.mockResolvedValue({
      ok: true,
      options: { challenge: "abc" },
    });
    startRegistration.mockResolvedValue({ id: "cred-1" });
    webauthnRegisterFinishFn.mockResolvedValue({ ok: true });

    const { queryClient } = renderButton();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await user.type(screen.getByLabelText(/nickname/i), "iPhone");
    await user.click(screen.getByRole("button", { name: /add this device/i }));

    await waitFor(() => {
      expect(webauthnRegisterFinishFn).toHaveBeenCalledWith({
        data: { response: { id: "cred-1" }, nickname: "iPhone" },
      });
    });

    expect(webauthnRegisterBeginFn).toHaveBeenCalled();
    expect(startRegistration).toHaveBeenCalledWith({
      optionsJSON: { challenge: "abc" },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
  });

  it("disables the button and shows the pending label while the ceremony runs", async () => {
    const user = userEvent.setup();
    let resolveBegin: (value: unknown) => void = () => {};
    webauthnRegisterBeginFn.mockReturnValue(
      new Promise((resolve) => {
        resolveBegin = resolve;
      }),
    );

    renderButton();
    await user.click(screen.getByRole("button", { name: /add this device/i }));

    const pendingButton = await screen.findByRole("button", {
      name: /waiting for device/i,
    });
    expect(pendingButton).toBeDisabled();

    // Resolve so the test doesn't leak a pending mutation.
    resolveBegin({ ok: false, reason: "rate_limited" });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /add this device/i }),
      ).toBeEnabled();
    });
  });

  it("surfaces the mapped error when begin returns ok=false", async () => {
    const user = userEvent.setup();
    webauthnRegisterBeginFn.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
    });

    renderButton();
    await user.click(screen.getByRole("button", { name: /add this device/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /sign in before adding a passkey/i,
    );
  });

  it("surfaces a default message when the browser ceremony throws", async () => {
    const user = userEvent.setup();
    webauthnRegisterBeginFn.mockResolvedValue({
      ok: true,
      options: { challenge: "abc" },
    });
    startRegistration.mockRejectedValue(new Error("user cancelled"));

    renderButton();
    await user.click(screen.getByRole("button", { name: /add this device/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /user cancelled/i,
    );
  });
});
