import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecordForm } from "#/features/conduct/components/record-form";
import { STATEMENT_TEMPLATE } from "#/features/conduct/server/limits";
import {
  createConductRecordFn,
  previewConductNoticeFn,
} from "#/features/conduct/server/record-fns";
import type { CorrectionDraft } from "#/features/conduct/server/record-fns";

vi.mock("#/features/conduct/server/record-fns", () => ({
  createConductRecordFn: vi.fn(),
  previewConductNoticeFn: vi.fn(),
  searchConductSubjectsFn: vi.fn(async () => []),
  listConductRecordsFn: vi.fn(async () => [
    {
      publicId: "crec_prior",
      level: "warning",
      subjectName: "Sam Subject",
      subjectPublicId: "pub_sam",
      startsOn: Temporal.PlainDate.from("2026-09-01"),
      endsOn: null,
      scocState: "none",
      liftedAt: null,
      createdAt: Temporal.Instant.from("2026-09-01T12:00:00Z"),
    },
    {
      publicId: "crec_lifted",
      level: "warning",
      subjectName: "Sam Subject",
      subjectPublicId: "pub_sam",
      startsOn: Temporal.PlainDate.from("2026-07-01"),
      endsOn: null,
      scocState: "none",
      liftedAt: Temporal.Instant.from("2026-07-20T12:00:00Z"),
      createdAt: Temporal.Instant.from("2026-07-01T12:00:00Z"),
    },
    {
      publicId: "crec_other",
      level: "warning",
      subjectName: "Someone Else",
      subjectPublicId: "pub_other",
      startsOn: Temporal.PlainDate.from("2026-08-01"),
      endsOn: null,
      scocState: "none",
      liftedAt: null,
      createdAt: Temporal.Instant.from("2026-08-01T12:00:00Z"),
    },
  ]),
}));

const SUBJECT = {
  userId: "user_sam",
  publicId: "pub_sam",
  fullName: "Sam Subject",
};

function renderForm(
  props: Partial<React.ComponentProps<typeof RecordForm>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecordForm initialSubject={SUBJECT} {...props} />
    </QueryClientProvider>,
  );
}

async function chooseLevel(
  user: ReturnType<typeof userEvent.setup>,
  level: string,
) {
  await user.click(levelRadio(level));
}

/** A level's card in the picker; its name starts with the level's label. */
function levelRadio(level: string) {
  const label = level.charAt(0).toUpperCase() + level.slice(1);
  return within(screen.getByRole("radiogroup", { name: "Level" })).getByRole(
    "radio",
    { name: new RegExp(`^${label}`) },
  );
}

async function fillStatement(user: ReturnType<typeof userEvent.setup>) {
  const field = screen.getByLabelText("Member statement");
  await user.clear(field);
  await user.type(field, "Final text.");
}

describe("RecordForm", () => {
  it("shows the exact email subject and text before a warning is issued", async () => {
    const user = userEvent.setup();
    vi.mocked(previewConductNoticeFn).mockResolvedValue({
      subject: "Notice of warning",
      text: "EXACT EMAIL BODY",
    });
    renderForm();
    await chooseLevel(user, "warning");
    await fillStatement(user);
    await user.click(screen.getByRole("button", { name: "Review and send" }));

    expect(await screen.findByText("Subject: Notice of warning")).toBeVisible();
    expect(screen.getByText("EXACT EMAIL BODY")).toBeVisible();
    expect(screen.getByRole("button", { name: "Issue warning" })).toBeEnabled();
    expect(previewConductNoticeFn).toHaveBeenCalledWith({
      data: { level: "warning", memberStatement: "Final text." },
    });
  });

  it("keeps issuing disabled when the preview fails", async () => {
    const user = userEvent.setup();
    vi.mocked(previewConductNoticeFn).mockRejectedValue(new Error("boom"));
    renderForm();
    await chooseLevel(user, "warning");
    await fillStatement(user);
    await user.click(screen.getByRole("button", { name: "Review and send" }));

    expect(
      await screen.findByText(/Could not load the email preview/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Issue warning" }),
    ).toBeDisabled();
  });

  it("offers a lifted warning as the prior warning, marked as lifted", async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseLevel(user, "termination");
    const picker = screen.getByLabelText("Prior warning");
    const lifted = await within(picker).findByRole("option", {
      name: /2026-07-01 \(lifted\)/,
    });
    expect(lifted).toBeEnabled();
    await user.selectOptions(picker, "crec_lifted");
    expect(picker).toHaveValue("crec_lifted");
  });

  it("blocks submitting while the statement has bracketed placeholders", async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseLevel(user, "warning");
    const submit = screen.getByRole("button", { name: "Review and send" });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/bracketed/);
    await fillStatement(user);
    expect(submit).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a suspension needs both dates while either is missing", async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseLevel(user, "suspension");
    await fillStatement(user);
    const submit = screen.getByRole("button", { name: "Review and send" });
    const hint = "A suspension needs a start date and an end date.";
    expect(screen.getByText(hint)).toBeVisible();
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Starts on"), "2026-11-01");
    expect(screen.getByText(hint)).toBeVisible();
    await user.type(screen.getByLabelText("Ends on"), "2026-12-01");
    expect(screen.queryByText(hint)).toBeNull();
    expect(submit).toBeEnabled();
  });

  it("has no member statement for a note", () => {
    renderForm();
    expect(screen.queryByLabelText("Member statement")).not.toBeInTheDocument();
  });

  it("pre-fills the statement from the template for a warning", async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseLevel(user, "warning");
    const field = screen.getByLabelText("Member statement");
    expect(field).toHaveValue(STATEMENT_TEMPLATE);
    expect(STATEMENT_TEMPLATE).toContain(
      "You may appeal in writing within two weeks to the Student Activities Board.",
    );
  });

  it("holds a termination back until the vote and the warning step are settled", async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseLevel(user, "termination");
    await fillStatement(user);
    const submit = screen.getByRole("button", { name: "Review and send" });

    await user.type(screen.getByLabelText("Vote held on"), "2026-10-20");
    await user.type(screen.getByLabelText("Committee size"), "9");
    await user.type(screen.getByLabelText("Votes for"), "5");
    await user.type(screen.getByLabelText("Votes against"), "2");
    await user.type(screen.getByLabelText("Abstentions"), "0");
    // 5 of 9 is short of two thirds.
    await user.click(
      await screen.findByRole("checkbox", { name: "No prior warning" }),
    );
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText("Votes for"));
    await user.type(screen.getByLabelText("Votes for"), "6");
    expect(submit).toBeEnabled();

    // Without the acknowledgment, a warning must be picked.
    await user.click(
      screen.getByRole("checkbox", { name: "No prior warning" }),
    );
    expect(submit).toBeDisabled();
    const picker = screen.getByLabelText("Prior warning");
    expect(
      await within(picker).findByRole("option", { name: /2026-09-01/ }),
    ).toBeInTheDocument();
    // Another member's warning is not offered.
    expect(
      within(picker).queryByRole("option", { name: /2026-08-01/ }),
    ).toBeNull();
    await user.selectOptions(picker, "crec_prior");
    expect(submit).toBeEnabled();

    await user.click(submit);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("locks the sanction levels and shows the SCCS number for a possible SCOC violation", async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseLevel(user, "warning");
    await user.click(screen.getByLabelText("Possible SCOC violation"));

    expect(levelRadio("note")).toBeChecked();
    for (const level of ["warning", "suspension", "termination"]) {
      expect(levelRadio(level)).toBeDisabled();
      expect(levelRadio(level)).toHaveAccessibleName(
        expect.stringContaining("goes to SCCS first"),
      );
    }
    expect(screen.getByText("513-556-6814")).toBeInTheDocument();
  });

  it("prefills a correction from the record and sends it as superseding", async () => {
    const user = userEvent.setup();
    vi.mocked(previewConductNoticeFn).mockResolvedValue({
      subject: "Corrected notice",
      text: "BODY",
    });
    vi.mocked(createConductRecordFn).mockResolvedValue({
      publicId: "crec_new",
    });
    const draft: CorrectionDraft = {
      subject: SUBJECT,
      level: "suspension",
      memberStatement: "You are suspended.",
      startsOn: Temporal.PlainDate.from("2026-11-01"),
      endsOn: Temporal.PlainDate.from("2026-12-01"),
      vote: null,
      priorWarningPublicId: null,
      warningSkipped: false,
    };
    renderForm({
      initialSubject: null,
      correction: { supersedesPublicId: "crec_old", draft },
    });

    expect(screen.getByText("Sam Subject")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Member/ })).toBeNull();
    expect(levelRadio("suspension")).toBeChecked();
    expect(
      within(screen.getByRole("radiogroup", { name: "Level" })).queryByRole(
        "radio",
        { name: /^Note/ },
      ),
    ).toBeNull();
    expect(screen.queryByLabelText("Possible SCOC violation")).toBeNull();
    expect(screen.getByLabelText("Member statement")).toHaveValue(
      "You are suspended.",
    );
    expect(screen.getByLabelText("Starts on")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("Ends on")).toHaveValue("2026-12-01");

    await user.click(screen.getByRole("button", { name: "Review and send" }));
    expect(await screen.findByText("Subject: Corrected notice")).toBeVisible();
    expect(previewConductNoticeFn).toHaveBeenLastCalledWith({
      data: {
        level: "suspension",
        memberStatement: "You are suspended.",
        startsOn: "2026-11-01",
        endsOn: "2026-12-01",
        supersedesPublicId: "crec_old",
      },
    });
    await user.click(screen.getByRole("button", { name: "Issue suspension" }));
    await vi.waitFor(() =>
      expect(createConductRecordFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          level: "suspension",
          subjectUserId: "user_sam",
          supersedesPublicId: "crec_old",
          memberStatement: "You are suspended.",
        }),
      }),
    );
  });

  it("prefills a termination's vote and warning step", () => {
    renderForm({
      initialSubject: null,
      correction: {
        supersedesPublicId: "crec_old",
        draft: {
          subject: SUBJECT,
          level: "termination",
          memberStatement: "Terminated.",
          startsOn: null,
          endsOn: null,
          vote: {
            heldOn: Temporal.PlainDate.from("2026-10-20"),
            for: 5,
            against: 1,
            abstain: 0,
            committeeSize: 7,
          },
          priorWarningPublicId: null,
          warningSkipped: true,
        },
      },
    });
    expect(screen.getByLabelText("Vote held on")).toHaveValue("2026-10-20");
    expect(screen.getByLabelText("Votes for")).toHaveValue(5);
    expect(screen.getByLabelText("Committee size")).toHaveValue(7);
    expect(screen.getByLabelText("No prior warning")).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Review and send" }),
    ).toBeEnabled();
  });
});
