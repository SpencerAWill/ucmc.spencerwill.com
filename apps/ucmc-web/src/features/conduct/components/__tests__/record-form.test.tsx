import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecordForm } from "#/features/conduct/components/record-form";
import { STATEMENT_TEMPLATE } from "#/features/conduct/server/limits";

vi.mock("#/features/conduct/server/record-fns", () => ({
  createConductRecordFn: vi.fn(),
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

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecordForm initialSubject={SUBJECT} />
    </QueryClientProvider>,
  );
}

async function chooseLevel(
  user: ReturnType<typeof userEvent.setup>,
  level: string,
) {
  await user.selectOptions(screen.getByLabelText("Level"), level);
}

async function fillStatement(user: ReturnType<typeof userEvent.setup>) {
  const field = screen.getByLabelText("Member statement");
  await user.clear(field);
  await user.type(field, "Final text.");
}

describe("RecordForm", () => {
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

  it("drops the sanction levels and shows the SCCS number for a possible SCOC violation", async () => {
    const user = userEvent.setup();
    renderForm();
    await chooseLevel(user, "warning");
    await user.click(screen.getByLabelText("Possible SCOC violation"));

    const options = within(screen.getByLabelText("Level"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Note"]);
    expect(screen.getByLabelText("Level")).toHaveValue("note");
    expect(screen.getByText("513-556-6814")).toBeInTheDocument();
  });
});
