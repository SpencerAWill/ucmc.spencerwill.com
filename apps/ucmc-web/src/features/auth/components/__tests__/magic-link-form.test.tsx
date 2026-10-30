import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MagicLinkForm } from "#/features/auth/components/magic-link-form";

const requestMagicLinkFn = vi.fn();

vi.mock("#/features/auth/server/server-fns", () => ({
  requestMagicLinkFn: (...args: unknown[]) => requestMagicLinkFn(...args),
}));

vi.mock("#/features/auth/server/webauthn-fns", () => ({
  // Conditional-UI autofill bails when `begin` returns ok=false. Component
  // tests don't exercise the passkey path — that's covered by the e2e and
  // the dedicated passkey-button tests.
  webauthnAuthenticateBeginFn: vi.fn().mockResolvedValue({ ok: false }),
  webauthnAuthenticateFinishFn: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// The site key is read on render, so one test can turn the widget on.
const mockEnv = vi.hoisted(() => ({
  VITE_TURNSTILE_SITE_KEY: undefined as string | undefined,
}));
vi.mock("#/config/env", () => ({ env: mockEnv }));

// Stand-in widget: a button per callback the form listens to.
vi.mock("@marsidev/react-turnstile", () => ({
  Turnstile: ({
    onSuccess,
    onExpire,
    onError,
  }: {
    onSuccess: (token: string) => void;
    onExpire: () => void;
    onError: () => void;
  }) => (
    <>
      <button type="button" onClick={() => onSuccess("turnstile-token")}>
        solve challenge
      </button>
      <button type="button" onClick={onExpire}>
        expire challenge
      </button>
      <button type="button" onClick={onError}>
        fail challenge
      </button>
    </>
  ),
}));

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MagicLinkForm />
    </QueryClientProvider>,
  );
}

describe("MagicLinkForm", () => {
  beforeEach(() => {
    requestMagicLinkFn.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockEnv.VITE_TURNSTILE_SITE_KEY = undefined;
  });

  it("renders the email field and the submit button", () => {
    renderForm();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /email me a link/i }),
    ).toBeInTheDocument();
  });

  it("always offers passkey autofill on the email field", () => {
    renderForm();
    expect(screen.getByLabelText(/email/i)).toHaveAttribute(
      "autocomplete",
      "username webauthn",
    );
  });

  it("disables the submit button until a valid email is entered", async () => {
    const user = userEvent.setup();
    renderForm();

    const button = screen.getByRole("button", { name: /email me a link/i });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    expect(button).toBeDisabled();

    await user.clear(screen.getByLabelText(/email/i));
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
  });

  it("calls requestMagicLinkFn with the entered email and shows the confirmation", async () => {
    const user = userEvent.setup();
    requestMagicLinkFn.mockResolvedValue({ ok: true, devOutboxHref: null });
    renderForm();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    await waitFor(() => {
      expect(requestMagicLinkFn).toHaveBeenCalledWith({
        data: { email: "alice@example.com", turnstileToken: "" },
      });
    });

    expect(await screen.findByText(/check.*for a link/i)).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("holds the submit button until the Turnstile widget answers", async () => {
    // The server verifies every token, an empty one too, so an early
    // submit would be dropped without the user being told (#381).
    mockEnv.VITE_TURNSTILE_SITE_KEY = "site-key";
    const user = userEvent.setup();
    requestMagicLinkFn.mockResolvedValue({ ok: true, devOutboxHref: null });
    renderForm();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    const button = screen.getByRole("button", { name: /email me a link/i });
    expect(button).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "solve challenge" }));
    await waitFor(() => {
      expect(button).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: "expire challenge" }));
    expect(button).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "solve challenge" }));
    await user.click(button);
    await waitFor(() => {
      expect(requestMagicLinkFn).toHaveBeenCalledWith({
        data: { email: "alice@example.com", turnstileToken: "turnstile-token" },
      });
    });
  });

  it("says why the button is held when the Turnstile widget fails", async () => {
    mockEnv.VITE_TURNSTILE_SITE_KEY = "site-key";
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "fail challenge" }));
    expect(
      screen.getByText(/verification check didn[’']?t load/i),
    ).toBeInTheDocument();

    // A retry that succeeds clears the message.
    await user.click(screen.getByRole("button", { name: "solve challenge" }));
    expect(
      screen.queryByText(/verification check didn[’']?t load/i),
    ).not.toBeInTheDocument();
  });

  it("links to the dev outbox when the server says the email went there", async () => {
    const user = userEvent.setup();
    requestMagicLinkFn.mockResolvedValue({
      ok: true,
      devOutboxHref: "/dev/outbox",
    });
    renderForm();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    const link = await screen.findByRole("link", {
      name: /open the dev outbox/i,
    });
    expect(link).toHaveAttribute("href", "/dev/outbox");
  });

  it("shows no outbox link when the server sends none, as on prod", async () => {
    const user = userEvent.setup();
    requestMagicLinkFn.mockResolvedValue({ ok: true, devOutboxHref: null });
    renderForm();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    await screen.findByText(/check.*for a link/i);
    expect(
      screen.queryByRole("link", { name: /dev outbox/i }),
    ).not.toBeInTheDocument();
  });

  it("surfaces an inline error when the request fails", async () => {
    const user = userEvent.setup();
    requestMagicLinkFn.mockRejectedValue(new Error("network down"));
    renderForm();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    expect(
      await screen.findByText(/couldn[’']?t send the email/i),
    ).toBeInTheDocument();
  });

  it("returns to the form when the user clicks 'Use a different email'", async () => {
    const user = userEvent.setup();
    requestMagicLinkFn.mockResolvedValue({ ok: true, devOutboxHref: null });
    renderForm();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(screen.getByRole("button", { name: /email me a link/i }));

    const reset = await screen.findByRole("button", {
      name: /use a different email/i,
    });
    await user.click(reset);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /email me a link/i }),
    ).toBeInTheDocument();
  });
});
