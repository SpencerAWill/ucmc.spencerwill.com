import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileForm } from "#/components/auth/profile-form";

import type * as ServerFns from "#/server/auth/server-fns";
import type * as ReactRouter from "@tanstack/react-router";

const submitProfileFn = vi.fn();
const navigateMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

// `profile-form.tsx` imports both `submitProfileFn` (a server fn we want to
// stub) AND validation schemas + limit constants from the same module
// (`profileInputSchema`, `BIO_LIMITS`, `PROFILE_LIMITS`, `countWords`). Use
// importActual so the real schemas/constants drive form validation while
// the server-fn is replaced.
vi.mock("#/server/auth/server-fns", async () => {
  const actual = await vi.importActual<typeof ServerFns>(
    "#/server/auth/server-fns",
  );
  return {
    ...actual,
    submitProfileFn: (...args: unknown[]) => submitProfileFn(...args),
    getSessionFn: vi.fn(),
    signOutFn: vi.fn(),
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    // useUnsavedChangesGuard calls useBlocker; outside of a router context
    // we just stub it out — the guard's behavior isn't what this test
    // validates.
    useBlocker: () => undefined,
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const VALID_DEFAULTS = {
  fullName: "Alice Example",
  preferredName: "Ali",
  mNumber: "M12345678",
  phone: "+15135551234",
  emergencyContacts: [
    {
      name: "Bob Example",
      phone: "+15135559999",
      relationship: "parent" as const,
    },
  ],
  ucAffiliation: "student" as const,
  bio: "I climb things.",
};

function renderForm(props: Partial<Parameters<typeof ProfileForm>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileForm
        email="alice@example.com"
        defaults={VALID_DEFAULTS}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("ProfileForm", () => {
  beforeEach(() => {
    submitProfileFn.mockReset();
    navigateMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the email as a readonly hint, not an editable field", () => {
    renderForm();
    const emailInput = screen.getByLabelText(/^email$/i);
    expect(emailInput).toHaveValue("alice@example.com");
    expect(emailInput).toHaveAttribute("readonly");
    expect(
      screen.getByText(/sign out and re-register with the new address/i),
    ).toBeInTheDocument();
  });

  it("submits the form, shows a success toast, and navigates to the configured target", async () => {
    const user = userEvent.setup();
    submitProfileFn.mockResolvedValue({ ok: true });

    renderForm({ redirectTo: "/account" });

    // The submit button is gated on `isDefaultValue` — so dirty up the form
    // by appending to the bio field before clicking submit.
    await user.type(screen.getByLabelText(/bio/i), " Edited.");
    await user.click(
      screen.getByRole("button", { name: /submit for review/i }),
    );

    await waitFor(() => {
      expect(submitProfileFn).toHaveBeenCalledTimes(1);
    });
    const [{ data }] = submitProfileFn.mock.calls[0] as [
      { data: typeof VALID_DEFAULTS },
    ];
    expect(data.fullName).toBe("Alice Example");
    expect(data.ucAffiliation).toBe("student");
    expect(data.bio).toBe("I climb things. Edited.");

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Profile submitted");
    });
    expect(navigateMock).toHaveBeenCalledWith({ to: "/account" });
  });

  it("shows an error toast and does not navigate when submission fails", async () => {
    const user = userEvent.setup();
    submitProfileFn.mockRejectedValue(new Error("boom"));

    renderForm();

    await user.type(screen.getByLabelText(/bio/i), " Edited.");
    await user.click(
      screen.getByRole("button", { name: /submit for review/i }),
    );

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/couldn[’']?t save your profile/i),
      );
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
