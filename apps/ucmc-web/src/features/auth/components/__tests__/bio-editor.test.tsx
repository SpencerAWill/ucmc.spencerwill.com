import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import { BioEditor } from "#/features/auth/components/bio-editor";

import type { ProfileFormShape } from "#/components/profile/profile-form-shape";
import type * as ReactRouter from "@tanstack/react-router";

const submitPublicProfileFn = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("#/features/auth/server/server-fns", () => ({
  submitPublicProfileFn: (...args: unknown[]) => submitPublicProfileFn(...args),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return { ...actual, useBlocker: () => undefined };
});

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const DEFAULTS: ProfileFormShape = {
  ...EMPTY_PROFILE_FORM_VALUES,
  fullName: "Alice Example",
  preferredName: "Ali",
  phone: "+15135551234",
  ucAffiliation: "student",
  bio: "",
};

function renderEditor(defaults: ProfileFormShape = DEFAULTS) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BioEditor defaults={defaults} />
    </QueryClientProvider>,
  );
}

describe("BioEditor", () => {
  beforeEach(() => {
    submitPublicProfileFn.mockReset();
    submitPublicProfileFn.mockResolvedValue({ ok: true });
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("submits the bio alongside the untouched public columns", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByLabelText(/bio/i), "I climb things.");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(submitPublicProfileFn).toHaveBeenCalledTimes(1);
    });
    const [{ data }] = submitPublicProfileFn.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data.bio).toBe("I climb things.");
    // `publicProfileInputSchema` takes all three columns, so these must
    // ride along unchanged rather than being dropped or blanked.
    expect(data.preferredName).toBe("Ali");
    expect(data.ucAffiliation).toBe("student");
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Bio saved");
    });
  });

  it("counts words and refuses to submit a bio over the cap", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByLabelText(/bio/i), "one two three");
    expect(screen.getByText(/^3 \/ \d+ words$/)).toBeInTheDocument();

    // 151 words trips the `BIO_LIMITS.maxWords` refine shared with the
    // server schema, so the submit gate stays closed.
    await user.clear(screen.getByLabelText(/bio/i));
    await user.type(
      screen.getByLabelText(/bio/i),
      Array.from({ length: 151 }, (_, i) => `w${i}`).join(" "),
    );
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeDisabled();
    expect(submitPublicProfileFn).not.toHaveBeenCalled();
  });

  it("shows an error toast when the save fails", async () => {
    const user = userEvent.setup();
    submitPublicProfileFn.mockRejectedValue(new Error("boom"));
    renderEditor();

    await user.type(screen.getByLabelText(/bio/i), "I climb things.");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/couldn[’']?t save your bio/i),
      );
    });
  });
});
