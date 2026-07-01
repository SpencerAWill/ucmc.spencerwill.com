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

function renderForm(mode: "sign-in" | "register" = "sign-in") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MagicLinkForm defaultMode={mode} />
    </QueryClientProvider>,
  );
}

describe("MagicLinkForm", () => {
  beforeEach(() => {
    requestMagicLinkFn.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the email field and the submit button with the sign-in label", () => {
    renderForm("sign-in");
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send sign-in link/i }),
    ).toBeInTheDocument();
  });

  it("renders the registration label when defaultMode is 'register'", () => {
    renderForm("register");
    expect(
      screen.getByRole("button", { name: /send registration link/i }),
    ).toBeInTheDocument();
  });

  it("disables the submit button until a valid email is entered", async () => {
    const user = userEvent.setup();
    renderForm();

    const button = screen.getByRole("button", { name: /send sign-in link/i });
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
    requestMagicLinkFn.mockResolvedValue({ ok: true });
    renderForm();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(
      screen.getByRole("button", { name: /send sign-in link/i }),
    );

    await waitFor(() => {
      expect(requestMagicLinkFn).toHaveBeenCalledWith({
        data: { email: "alice@example.com", turnstileToken: "" },
      });
    });

    expect(
      await screen.findByText(/check.*for a sign-in link/i),
    ).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("surfaces an inline error when the request fails", async () => {
    const user = userEvent.setup();
    requestMagicLinkFn.mockRejectedValue(new Error("network down"));
    renderForm();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(
      screen.getByRole("button", { name: /send sign-in link/i }),
    );

    expect(
      await screen.findByText(/couldn[’']?t send the email/i),
    ).toBeInTheDocument();
  });

  it("returns to the form when the user clicks 'Use a different email'", async () => {
    const user = userEvent.setup();
    requestMagicLinkFn.mockResolvedValue({ ok: true });
    renderForm();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.click(
      screen.getByRole("button", { name: /send sign-in link/i }),
    );

    const reset = await screen.findByRole("button", {
      name: /use a different email/i,
    });
    await user.click(reset);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send sign-in link/i }),
    ).toBeInTheDocument();
  });
});
