import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_PROFILE_FORM_VALUES } from "#/components/profile/profile-form-shape";
import { ContactsEditor } from "#/features/auth/components/contacts-editor";

import type { ProfileFormShape } from "#/components/profile/profile-form-shape";
import type * as ReactRouter from "@tanstack/react-router";

const submitDetailsFn = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("#/features/auth/server/server-fns", () => ({
  submitDetailsFn: (...args: unknown[]) => submitDetailsFn(...args),
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
  bio: "I climb things.",
  emergencyContacts: [],
};

function renderEditor(defaults: ProfileFormShape = DEFAULTS) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContactsEditor defaults={defaults} />
    </QueryClientProvider>,
  );
}

describe("ContactsEditor", () => {
  beforeEach(() => {
    submitDetailsFn.mockReset();
    submitDetailsFn.mockResolvedValue({ ok: true });
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("submits a new contact alongside the untouched legal name and phone", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(
      screen.getByRole("button", { name: /add emergency contact/i }),
    );
    await user.type(screen.getByLabelText(/^name$/i), "Bob Example");
    // The phone field parses each keystroke into E.164, so type rather
    // than setting the display value wholesale.
    await user.type(screen.getByLabelText(/^phone$/i), "5135559999");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(submitDetailsFn).toHaveBeenCalledTimes(1);
    });
    const [{ data }] = submitDetailsFn.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data.emergencyContacts).toEqual([
      {
        name: "Bob Example",
        phone: "+15135559999",
        relationship: "other",
      },
    ]);
    // The whole `detailsInputSchema` shape goes over the wire, so these
    // two must ride along unchanged — omitting them blanks the columns.
    expect(data.fullName).toBe("Alice Example");
    expect(data.phone).toBe("+15135551234");
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Emergency contacts saved");
    });
  });

  it("shows an error toast when the save fails", async () => {
    const user = userEvent.setup();
    submitDetailsFn.mockRejectedValue(new Error("boom"));
    renderEditor({
      ...DEFAULTS,
      emergencyContacts: [
        { name: "Bob Example", phone: "+15135559999", relationship: "parent" },
      ],
    });

    await user.type(screen.getByLabelText(/^name$/i), " Jr");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/couldn[’']?t save your contacts/i),
      );
    });
  });
});
