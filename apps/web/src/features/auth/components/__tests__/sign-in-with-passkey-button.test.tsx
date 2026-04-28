import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignInWithPasskeyButton } from "#/features/auth/components/sign-in-with-passkey-button";

const webauthnAuthenticateBeginFn = vi.fn();
const webauthnAuthenticateFinishFn = vi.fn();
const startAuthentication = vi.fn();
const navigateMock = vi.fn();

vi.mock("#/features/auth/server/webauthn-fns", () => ({
  webauthnAuthenticateBeginFn: (...args: unknown[]) =>
    webauthnAuthenticateBeginFn(...args),
  webauthnAuthenticateFinishFn: (...args: unknown[]) =>
    webauthnAuthenticateFinishFn(...args),
}));

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: (...args: unknown[]) => startAuthentication(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

// SESSION_QUERY_KEY pulls in #/server/auth/server-fns transitively; stub it
// so the import tree resolves without booting the real server fns.
vi.mock("#/features/auth/server/server-fns", () => ({
  getSessionFn: vi.fn(),
  signOutFn: vi.fn(),
}));

function renderButton() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SignInWithPasskeyButton />
    </QueryClientProvider>,
  );
}

describe("SignInWithPasskeyButton", () => {
  beforeEach(() => {
    webauthnAuthenticateBeginFn.mockReset();
    webauthnAuthenticateFinishFn.mockReset();
    startAuthentication.mockReset();
    navigateMock.mockReset();
    // jsdom defines window.PublicKeyCredential as undefined by default —
    // simulate a WebAuthn-capable browser so the feature-detection effect
    // sets isSupported=true.
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: function MockPublicKeyCredential() {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { PublicKeyCredential?: unknown })
      .PublicKeyCredential;
  });

  it("renders the trigger when WebAuthn is supported", async () => {
    renderButton();
    expect(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    ).toBeInTheDocument();
  });

  it("renders nothing when WebAuthn is unsupported", () => {
    delete (window as unknown as { PublicKeyCredential?: unknown })
      .PublicKeyCredential;
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("navigates home when an approved user with a profile signs in", async () => {
    const user = userEvent.setup();
    webauthnAuthenticateBeginFn.mockResolvedValue({
      ok: true,
      options: { challenge: "abc" },
    });
    startAuthentication.mockResolvedValue({ id: "cred-1" });
    webauthnAuthenticateFinishFn.mockResolvedValue({
      ok: true,
      hasProfile: true,
      status: "approved",
    });

    renderButton();
    await user.click(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: "/" });
    });
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "abc" },
      useBrowserAutofill: false,
    });
  });

  it("routes to /register/profile when the user has no profile", async () => {
    const user = userEvent.setup();
    webauthnAuthenticateBeginFn.mockResolvedValue({
      ok: true,
      options: { challenge: "abc" },
    });
    startAuthentication.mockResolvedValue({ id: "cred-1" });
    webauthnAuthenticateFinishFn.mockResolvedValue({
      ok: true,
      hasProfile: false,
      status: "pending",
    });

    renderButton();
    await user.click(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: "/register/profile" });
    });
  });

  it("routes to /register/pending when the user has a profile but is unapproved", async () => {
    const user = userEvent.setup();
    webauthnAuthenticateBeginFn.mockResolvedValue({
      ok: true,
      options: { challenge: "abc" },
    });
    startAuthentication.mockResolvedValue({ id: "cred-1" });
    webauthnAuthenticateFinishFn.mockResolvedValue({
      ok: true,
      hasProfile: true,
      status: "pending",
    });

    renderButton();
    await user.click(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    );

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: "/register/pending" });
    });
  });

  it("surfaces the mapped reason when begin returns ok=false", async () => {
    const user = userEvent.setup();
    webauthnAuthenticateBeginFn.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
    });

    renderButton();
    await user.click(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /too many requests/i,
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("surfaces a default message when the browser ceremony throws", async () => {
    const user = userEvent.setup();
    webauthnAuthenticateBeginFn.mockResolvedValue({
      ok: true,
      options: { challenge: "abc" },
    });
    startAuthentication.mockRejectedValue(new Error("user cancelled"));

    renderButton();
    await user.click(
      await screen.findByRole("button", { name: /sign in with a passkey/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /user cancelled/i,
    );
  });
});
